#!/bin/bash

# ==========================================================================
# Script triển khai ZenFinance lên GitHub Pages (Tự động đẩy thư mục frontend)
# ==========================================================================

# Định dạng màu sắc
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}==================================================${NC}"
echo -e "${BLUE}     ZenFinance - GitHub Pages Deploy Script      ${NC}"
echo -e "${BLUE}==================================================${NC}"

# 1. Kiểm tra Git
if ! command -v git &> /dev/null; then
    echo -e "${RED}Lỗi: Git chưa được cài đặt trên máy tính này. Vui lòng cài đặt Git và thử lại.${NC}"
    exit 1
fi

# 2. Kiểm tra liên kết Repository trên GitHub (Remote origin)
if ! git remote get-url origin &> /dev/null; then
    echo -e "${YELLOW}Cảnh báo: Chưa phát hiện liên kết Repository GitHub (thiếu remote 'origin').${NC}"
    echo -e "Vui lòng làm theo các bước sau để liên kết:"
    echo -e "  1. Truy cập GitHub.com và tạo một Repository mới (Khuyên dùng: Private)."
    echo -e "  2. Chạy lệnh liên kết trong Terminal:"
    echo -e "     ${GREEN}git remote add origin <URL_REPOSITORY_CUA_BAN>${NC}"
    echo -e "     Ví dụ: git remote add origin https://github.com/username/zenfinance.git"
    echo -e "  3. Sau đó chạy lại script deploy này: ${GREEN}./deploy.sh${NC}"
    exit 1
fi

# 3. Kiểm tra xem có thay đổi nào chưa commit trong thư mục frontend/ không
if ! git diff-index --quiet HEAD -- frontend/; then
    echo -e "${YELLOW}Phát hiện có thay đổi chưa commit trong thư mục frontend/.${NC}"
    echo -e "Đang tự động tạo commit cho các thay đổi mới nhất..."
    git add frontend/
    git commit -m "Auto-commit before deploy: $(date '+%Y-%m-%d %H:%M:%S')"
fi

# 4. Đẩy mã nguồn chính lên nhánh main của GitHub
echo -e "\n${BLUE}[1/2] Đang đẩy mã nguồn dự án lên nhánh main trên GitHub...${NC}"
if git push origin main; then
    echo -e "${GREEN}✓ Đã đẩy mã nguồn lên GitHub thành công!${NC}"
else
    echo -e "${YELLOW}Cảnh báo: Đẩy mã nguồn chính thất bại. Có thể do conflict hoặc chưa phân quyền. Vẫn tiếp tục deploy web tĩnh...${NC}"
fi

# 5. Đẩy riêng thư mục frontend/ lên nhánh gh-pages của GitHub
echo -e "\n${BLUE}[2/2] Đang tách thư mục frontend/ và đẩy lên nhánh gh-pages...${NC}"
echo -e "Vui lòng chờ giây lát..."

# Thực hiện lệnh git subtree push
if git subtree push --prefix frontend origin gh-pages; then
    echo -e "${GREEN}==================================================${NC}"
    echo -e "${GREEN}✓ TRIỂN KHAI THÀNH CÔNG LÊN GITHUB PAGES!${NC}"
    echo -e "${GREEN}==================================================${NC}"
    
    # Lấy thông tin repository để suy ra đường dẫn web
    REMOTE_URL=$(git remote get-url origin)
    
    # Chuẩn hóa URL để trích xuất username và repo-name
    # Hỗ trợ cả định dạng HTTPS (https://github.com/user/repo.git) và SSH (git@github.com:user/repo.git)
    if [[ $REMOTE_URL =~ github.com[:/]([^/]+)/([^.]+)(.git)? ]]; then
        USER_NAME="${BASH_REMATCH[1]}"
        REPO_NAME="${BASH_REMATCH[2]}"
        WEB_URL="https://${USER_NAME}.github.io/${REPO_NAME}/"
        
        echo -e "\n👉 Đường dẫn trang web của bạn (có thể mất 1-3 phút để hoạt động):"
        echo -e "   ${BLUE}${WEB_URL}${NC}"
        echo -e "\n${YELLOW}Lưu ý quan trọng:${NC}"
        echo -e "1. Nếu truy cập báo lỗi 404, bạn vào Repository GitHub -> ${BLUE}Settings${NC} -> ${BLUE}Pages${NC}."
        echo -e "2. Kiểm tra xem phần ${BLUE}Build and deployment${NC} -> ${BLUE}Branch${NC} đã chọn là ${BLUE}gh-pages / (root)${NC} chưa."
        echo -e "3. Nếu chưa, hãy chọn nó và bấm ${BLUE}Save${NC}."
    else
        echo -e "\n👉 Web của bạn sẽ hoạt động tại địa chỉ: https://<username>.github.io/<repo-name>/"
    fi
else
    echo -e "${RED}Lỗi: Triển khai lên GitHub Pages thất bại.${NC}"
    echo -e "Mẹo khắc phục: Nếu gặp lỗi subtree cũ, bạn có thể xóa nhánh gh-pages trên GitHub bằng lệnh:"
    echo -e "  git push origin --delete gh-pages"
    echo -e "Sau đó chạy lại script này."
    exit 1
fi
