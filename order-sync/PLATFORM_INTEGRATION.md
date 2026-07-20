# OrderSync — Tài liệu tích hợp phía nền tảng

Tài liệu này mô tả những gì **nền tảng (web chính)** cần build để nhận đơn hàng
từ app OrderSync. App là bên **gửi**; nền tảng là bên **nhận**.

Không cần đọc code của app để làm phần này — toàn bộ contract nằm ở đây.

---

## 1. Bức tranh tổng thể

```
Shopify store          App OrderSync              Nền tảng (web chính)
    │                       │                            │
    │  đơn mới              │                            │
    │─── orders/create ────>│                            │
    │                       │  xác thực HMAC             │
    │                       │  lấy token của shop        │
    │                       │─── POST /orders ──────────>│  ← BẠN BUILD phần này
    │                       │    X-API-Key: <token>      │
    │                       │<────── 200 OK ─────────────│
    │<──── 200 OK ──────────│                            │
```

Mỗi khi có đơn mới, app tự POST một JSON đơn hàng sang nền tảng. Nền tảng chỉ
cần làm hai việc:

1. **Cấp token tích hợp** cho từng merchant (mục 2).
2. **Nhận đơn** ở một endpoint HTTP (mục 3).

---

## 2. Cấp token tích hợp

App là multi-tenant — nhiều merchant cùng cài, mỗi merchant có tài khoản riêng
trên nền tảng. Nên **mỗi merchant phải có token riêng**, không dùng chung.

Nền tảng cần cung cấp:

- **Chỗ để merchant tạo token** trong tài khoản của họ (kiểu như API key của
  Stripe/GitHub). Merchant bấm tạo, copy token, dán vào trang settings của app.
- Token nên **dài hạn** (không hết hạn), hoặc nếu hết hạn thì phải nói rõ cơ chế
  gia hạn — app hiện KHÔNG tự refresh token.
- Token phải **định danh được merchant**: khi app gọi tới kèm token, nền tảng
  phải biết đơn này thuộc tài khoản nào.
- Nên cho phép **thu hồi** từng token độc lập.

App lưu token này (mã hoá) và gửi kèm trong mọi request qua header `X-API-Key`.

### (Tuỳ chọn) Endpoint kiểm tra token

Nếu nền tảng có một endpoint xác thực token, app sẽ gọi nó ngay khi merchant dán
token, để báo lỗi sớm nếu token sai — thay vì để mất đơn âm thầm.

```
POST <PLATFORM_VERIFY_PATH>
Header: X-API-Key: <token>
```

- Token hợp lệ → trả **2xx**.
- Token sai → trả **4xx**.

Nếu nền tảng chưa có endpoint này thì bỏ trống, app sẽ chấp nhận token luôn.

---

## 3. Endpoint nhận đơn — phần chính cần build

### Request app sẽ gửi

```
POST <PLATFORM_API_URL><PLATFORM_ORDERS_PATH>     (mặc định path = /orders)
Content-Type:      application/json
X-API-Key:         <token của merchant>
X-Idempotency-Key: <shop-domain>:<order-id>
```

- **`X-API-Key`** — token ở mục 2. Dùng để xác thực VÀ để biết đơn thuộc merchant nào.
- **`X-Idempotency-Key`** — khoá chống trùng, ví dụ `vcn-store.myshopify.com:5678901234567`.
  Shopify có thể gửi lặp cùng một đơn; nền tảng nên dùng khoá này để bỏ qua bản trùng
  (xem mục 5).

### Body — cấu trúc JSON

Đây là payload thật app gửi (đã test). Mọi `id` đều là **string**. Giá tiền là
**string** (theo đúng định dạng Shopify trả về). Trường không có giá trị là `null`.

```json
{
  "source": "shopify",
  "shop_domain": "vcn-store.myshopify.com",
  "order_id": "5678901234567",
  "order_number": "#1001",
  "created_at": "2026-07-15T10:30:00-04:00",
  "currency": "VND",
  "subtotal": "450000",
  "tax": "45000",
  "total": "495000",
  "financial_status": "paid",
  "fulfillment_status": null,
  "customer": {
    "email": "khach@example.com",
    "phone": "+84900000000",
    "first_name": "Van A",
    "last_name": "Nguyen"
  },
  "shipping_address": {
    "address1": "123 Le Loi",
    "city": "Ho Chi Minh",
    "country": "Vietnam"
  },
  "line_items": [
    {
      "product_id": "111",
      "variant_id": "222",
      "sku": "LAMP-01",
      "title": "Resin Lamp",
      "variant_title": "Blue",
      "quantity": 2,
      "price": "225000"
    },
    {
      "product_id": null,
      "variant_id": null,
      "sku": null,
      "title": "Gift wrap",
      "variant_title": null,
      "quantity": 1,
      "price": "0"
    }
  ]
}
```

### Bảng field

| Field | Kiểu | Ghi chú |
|---|---|---|
| `source` | string | Luôn là `"shopify"`. |
| `shop_domain` | string | Domain `.myshopify.com` của store. Xác định store gửi đơn. |
| `order_id` | string | ID đơn của Shopify. Duy nhất trong 1 store. |
| `order_number` | string | Số đơn hiển thị cho khách, ví dụ `#1001`. |
| `created_at` | string | ISO 8601, có timezone. |
| `currency` | string | Mã tiền tệ ISO, ví dụ `VND`, `USD`. |
| `subtotal` / `tax` / `total` | string | Số tiền dạng chuỗi thập phân. **Nên parse sang số/decimal ở nền tảng.** |
| `financial_status` | string \| null | `paid`, `pending`, `refunded`… |
| `fulfillment_status` | string \| null | `null` nếu chưa fulfill. |
| `customer.*` | string \| null | PII khách hàng. Xem mục 6. |
| `shipping_address` | object \| null | `null` với đơn không cần giao (digital). |
| `line_items[]` | array | Có thể chứa dòng không có `product_id` (ví dụ phí gói quà). |
| `line_items[].price` | string | Đơn giá 1 sản phẩm, chưa nhân số lượng. |

> **Lưu ý:** cấu trúc này do phía app định nghĩa (hàm `mapOrder`). Nếu nền tảng
> muốn nhận theo schema khác, báo lại — sửa ở app một chỗ là xong, không cần
> nền tảng phải chiều theo shape này.

---

## 4. Response nền tảng phải trả — RẤT QUAN TRỌNG

App diễn giải response theo đúng quy ước sau, và nó ảnh hưởng trực tiếp tới việc
đơn có bị mất hay không:

| Nền tảng trả | App hiểu là | Hậu quả |
|---|---|---|
| **2xx** (200/201) | Lưu thành công | App đánh dấu đã đồng bộ, không gửi lại. |
| **4xx / 5xx** hoặc timeout | Thất bại | App trả 500 cho Shopify → **Shopify tự gửi lại** với backoff, tối đa ~48h. |

Ý nghĩa thực tế:

- **Chỉ trả 2xx khi đã LƯU CHẮC CHẮN đơn.** Nếu trả 2xx rồi mới xử lý và lỗi,
  đơn sẽ mất vĩnh viễn vì app sẽ không gửi lại nữa.
- **Nền tảng sập/lỗi thì cứ trả 5xx** (hoặc để timeout). Đơn không mất — Shopify
  sẽ gửi lại khi nền tảng sống lại. Đây là "hàng đợi retry miễn phí".
- **Token sai → trả 401/403.** App sẽ log và retry; merchant cần dán lại token đúng.

### Ràng buộc thời gian

App đặt timeout **3 giây** cho request sang nền tảng (vì Shopify cắt webhook ở 5s).
→ **Endpoint nhận đơn phải phản hồi trong ~3 giây.**

Nếu việc xử lý đơn của nền tảng nặng (gọi service khác, gửi email…), đừng làm
đồng bộ trong request này. Hãy: nhận đơn → lưu nhanh vào DB/queue → trả 2xx ngay
→ xử lý nền sau. Chậm quá sẽ bị coi là thất bại và tạo ra retry không cần thiết.

---

## 5. Chống trùng (idempotency)

Shopify **có thể gửi cùng một đơn nhiều lần** — đây là hành vi bình thường, không
phải lỗi. App đã chống trùng ở phía nó, nhưng nền tảng **nên chống trùng thêm một
lớp** để chắc chắn không tạo 2 bản ghi cho 1 đơn.

Cách làm: dùng header `X-Idempotency-Key` (dạng `shop_domain:order_id`), hoặc tự
ghép `shop_domain` + `order_id` trong body.

```
Nhận đơn
  → đã tồn tại (shop_domain, order_id)?
      → có  : bỏ qua, trả 2xx (coi như thành công)
      → chưa: lưu mới, trả 2xx
```

Nên đặt **unique constraint** trên cặp `(shop_domain, order_id)` ở DB để tránh
race condition khi hai bản trùng tới gần như đồng thời.

---

## 6. Dữ liệu cá nhân khách hàng (PII)

Payload chứa email, số điện thoại, địa chỉ khách. Vài lưu ý:

- Nền tảng phải **lưu trữ và bảo vệ PII** đúng quy định (mã hoá, kiểm soát truy cập).
- App có sẵn các webhook GDPR của Shopify. Khi khách yêu cầu **xoá dữ liệu**
  (`customers/redact`) hoặc store gỡ app (`shop/redact`), app cần gọi sang nền
  tảng để xoá. **Nền tảng nên cung cấp một endpoint xoá** theo `shop_domain` (và
  theo khách nếu có), ví dụ:

  ```
  DELETE /orders?shop_domain=<domain>            (xoá toàn bộ đơn của 1 store)
  POST   /gdpr/redact-customer  { shop_domain, customer_id }
  ```

  Cho tôi biết endpoint xoá khi có, tôi nối vào webhook `customers/redact` /
  `shop/redact` phía app (hiện đang để TODO).

---

## 7. Checklist cho phía nền tảng

- [ ] Có chỗ cho merchant **tạo / thu hồi integration token**.
- [ ] Token **định danh được merchant** khi nhận request.
- [ ] Endpoint **`POST /orders`** nhận payload ở mục 3.
- [ ] Xác thực bằng header **`X-API-Key`**; token sai → 401/403.
- [ ] **Chống trùng** theo `(shop_domain, order_id)`, unique constraint ở DB.
- [ ] Trả **2xx chỉ khi đã lưu chắc**; lỗi thì trả **5xx** để Shopify retry.
- [ ] Phản hồi **trong ~3 giây** (xử lý nặng thì đẩy sang nền).
- [ ] (Tuỳ chọn) Endpoint **verify token** để app báo lỗi sớm khi merchant kết nối.
- [ ] (Khi có) Endpoint **xoá dữ liệu** theo `shop_domain` cho GDPR.

---

## 8. Test nhanh bằng curl

Mô phỏng đúng request app gửi, để test endpoint nền tảng trước khi nối thật:

```sh
curl -i -X POST "https://your-platform.com/api/orders" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <token-test>" \
  -H "X-Idempotency-Key: test-store.myshopify.com:999" \
  -d '{
    "source": "shopify",
    "shop_domain": "test-store.myshopify.com",
    "order_id": "999",
    "order_number": "#TEST",
    "currency": "VND",
    "total": "100000",
    "financial_status": "paid",
    "customer": { "email": "test@example.com" },
    "line_items": [
      { "sku": "TEST-01", "title": "Test item", "quantity": 1, "price": "100000" }
    ]
  }'
```

Gọi lần 2 với cùng `order_id` → nền tảng phải **không** tạo bản ghi thứ hai.
```
