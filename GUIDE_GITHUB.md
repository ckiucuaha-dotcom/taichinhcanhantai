# Hướng dẫn đưa ZenFinance lên GitHub & Chạy Online qua GitHub Pages

Tài liệu này hướng dẫn chi tiết từng bước để thiết lập đồng bộ dữ liệu đám mây qua **GitHub Gist** và triển khai trang web lên **GitHub Pages** để sử dụng trên điện thoại (4G/5G) mọi lúc mọi nơi.

---

## 🛠 Phần 1: Thiết lập Repository trên GitHub & Triển khai web

### Bước 1: Tạo Repository trên GitHub
1. Truy cập trang web [GitHub](https://github.com/) và đăng nhập tài khoản của bạn.
2. Nhấp vào nút **New** (hoặc dấu cộng `+` ở góc trên cùng bên phải -> **New repository**).
3. Thiết lập thông số:
   - **Repository name**: Nhập tên bất kỳ, ví dụ: `zenfinance`.
   - **Public/Private**: **BẮT BUỘC chọn PRIVATE** (để giữ bảo mật tối đa cho mã nguồn và các file cấu hình).
   - *Không tích chọn bất kỳ mục nào khác* (không Add README, không .gitignore, không License).
4. Nhấn nút **Create repository**.

### Bước 2: Liên kết và Triển khai từ Máy tính
1. Mở ứng dụng **Terminal** trên máy Mac.
2. Di chuyển vào thư mục dự án (hoặc bạn có thể để Agent hỗ trợ chạy lệnh này).
3. Chạy lệnh liên kết Remote (thay thế URL bằng link repo GitHub của bạn vừa tạo):
   ```bash
   git remote add origin https://github.com/<tên-tài-khoản>/<tên-repo>.git
   ```
4. Chạy script triển khai tự động:
   ```bash
   ./deploy.sh
   ```
5. Khi script chạy xong, nó sẽ cung cấp cho bạn một đường dẫn dạng:
   `https://<tên-tài-khoản>.github.io/<tên-repo>/`
   *(Đây chính là đường dẫn web của bạn!)*

---

## 🔑 Phần 2: Cấu hình Đồng bộ Đám mây (Gist Cloud Sync)

Để web hoạt động độc lập mà không cần bật máy tính ở nhà, dữ liệu tài chính của bạn sẽ được lưu trong một **Secret Gist** (tệp ẩn bảo mật của riêng bạn).

### Bước 1: Tạo GitHub Personal Access Token (PAT)
Token này đóng vai trò như chìa khóa bảo mật giúp trang web ZenFinance ghi/đọc dữ liệu lên Gist.
1. Nhấp trực tiếp vào liên kết tạo nhanh này: **[Tạo GitHub Token cho ZenFinance](https://github.com/settings/tokens/new?scopes=gist&description=ZenFinance%20Sync)**
2. Nhập các thông tin:
   - **Expiration**: Chọn thời hạn (ví dụ: `No expiration` - Không bao giờ hết hạn để tránh phải lấy lại token, hoặc chọn thời gian tùy ý bạn).
   - **Select scopes**: Chắc chắn rằng ô **`gist`** đã được tích chọn (các quyền khác bỏ trống).
3. Nhấp nút **Generate token** ở cuối trang.
4. **Copy mã Token** (chuỗi ký tự bắt đầu bằng `ghp_...`). 
   ⚠️ *Hãy lưu mã này vào ghi chú hoặc nơi an toàn, vì nó chỉ hiển thị duy nhất 1 lần.*

### Bước 2: Kích hoạt đồng bộ Cloud trên Web
1. Mở trang web ZenFinance của bạn (bằng link GitHub Pages vừa tạo ở Phần 1 hoặc chạy cục bộ ở máy tính).
2. Trên thanh menu bên trái (Sidebar), nhấp vào nút **Cấu hình Cloud Gist** (hoặc click trực tiếp vào dòng chữ "Đồng bộ Excel / Đồng bộ Máy chủ").
3. Một hộp thoại hiện ra, bạn điền:
   - **GitHub Personal Access Token (PAT)**: Dán mã `ghp_...` vừa copy ở Bước 1 vào.
   - **GitHub Gist ID**: *Để trống nếu bạn thiết lập lần đầu.*
4. Nhấp vào nút **Tạo Gist mới** ở bên phải trường Gist ID.
   - Hệ thống sẽ tự động tạo một tệp ẩn (Gist) chứa dữ liệu tài chính hiện tại của bạn và điền mã Gist ID vào ô nhập liệu.
5. Nhấp nút **Lưu cấu hình**.
6. Trang web sẽ tự động tải lại và hiển thị trạng thái kết nối màu xanh lam: **`☁ Đồng bộ Cloud Gist`**.

---

## 📱 Phần 3: Đồng bộ trên Điện thoại và các thiết bị khác

Từ nay về sau, bạn chỉ cần thực hiện 1 lần duy nhất trên mỗi thiết bị mới (như điện thoại, ipad, máy tính khác):
1. Truy cập vào link GitHub Pages của bạn: `https://<tên-tài-khoản>.github.io/<tên-repo>/`
2. Nhấp vào connection badge (ở cạnh tiêu đề header trên điện thoại) để mở cài đặt kết nối.
3. Điền đúng **GitHub Token** và **Gist ID** đã tạo.
4. Nhấn **Lưu cấu hình**.
5. Nhấn **Tải Cloud về Local** để đồng bộ toàn bộ dữ liệu hiện tại từ đám mây xuống thiết bị.

*Từ nay, mọi giao dịch bạn nhập trên điện thoại hoặc máy tính đều sẽ được đồng bộ tức thì qua GitHub Gist!*
