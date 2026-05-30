// --- 1. CHẶN CHUỘT PHẢI CẤP ĐỘ TRÌNH DUYỆT & PHÍM TẮT F12/QUÉT KHỐI ---
document.addEventListener('contextmenu', event => event.preventDefault());
document.addEventListener('keydown', (e) => {
    // Chặn F12, Ctrl+Shift+I, Ctrl+Shift+C, Ctrl+Shift+J, Ctrl+U
    if (e.key === 'F12' || 
        (e.ctrlKey && e.shiftKey && ['I', 'C', 'J'].includes(e.key.toUpperCase())) || 
        (e.ctrlKey && e.key.toUpperCase() === 'U')) {
        e.preventDefault();
    }
});

// Tiền tố bảo mật nội bộ tránh trùng lặp trên hệ thống PeerJS toàn cầu
const APP_PREFIX = "cuong_vst_p2p_"; 

let peer = null;
let connection = null;
let myShortCode = "";
let selectedFile = null;

// Các phần tử DOM tương tác với giao diện HTML
const myIdEl = document.getElementById('my-peer-id');
const fileInput = document.getElementById('file-input');
const fileInfo = document.getElementById('file-info');
const codeBox = document.getElementById('code-box');
const generatedCodeEl = document.getElementById('generated-code');
const receiveInput = document.getElementById('receive-code-input');
const connectBtn = document.getElementById('connect-btn');
const progressSection = document.getElementById('progress-section');
const statusText = document.getElementById('status-text');
const statusPercent = document.getElementById('status-percent');
const progressBar = document.getElementById('progress-bar');

// --- 2. CẤU HÌNH PEERJS + TỐI ƯU XUYÊN TƯỜNG LỬA (STUN GOOGLE) ---
function initPeerWithRetry() {
    // Sinh ngẫu nhiên chuỗi 6 chữ số ban đầu
    const random6Digits = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Tích hợp chữ "C" cố định vào đầu chuỗi mã định danh hiển thị công khai
    myShortCode = "C" + random6Digits; 
    
    // Khởi tạo thực thể mạng Peer với cấu trúc ID hoàn chỉnh
    peer = new Peer(APP_PREFIX + myShortCode, {
        config: {
            'iceServers': [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ]
        }
    });

    // Xác nhận đăng ký ID thành công với hệ thống định tuyến toàn cầu
    peer.on('open', (id) => {
        myIdEl.innerText = myShortCode;
        console.log("Hệ thống kết nối thành công với ID ngầm: " + id);
    });

    // Cơ chế xử lý lỗi và tự động đổi mã mới nếu xảy ra xung đột ID ngẫu nhiên
    peer.on('error', (err) => {
        console.error("Lỗi hệ thống: ", err.type);
        if (err.type === 'unavailable-id') {
            initPeerWithRetry();
        } else {
            statusText.innerText = "Lỗi kết nối mạng!";
        }
    });

    // LẮNG NGHE YÊU CẦU KẾT NỐI TỪ THIẾT BỊ NHẬN (DÀNH CHO PHÍA GỬI)
    peer.on('connection', (conn) => {
        connection = conn;
        setupConnectionListeners();
    });
}

initPeerWithRetry();

// --- 3. XỬ LÝ LOGIC PHÍA GỬI FILE ---
fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        selectedFile = e.target.files[0];
        fileInfo.innerText = `${selectedFile.name} (${formatBytes(selectedFile.size)})`;
        
        // Kích hoạt hiển thị giao diện mã ghép cặp bảo mật dạng Cxxxxxx
        generatedCodeEl.innerText = myShortCode;
        codeBox.style.display = "block";
    }
});

// --- 4. XỬ LÝ LOGIC PHÍA NHẬN FILE ---
connectBtn.addEventListener('click', () => {
    let code = receiveInput.value.trim();
    
    // Tự động chuẩn hóa chữ thường thành chữ hoa (ví dụ: c112233 -> C112233)
    code = code.toUpperCase(); 

    // Kiểm tra tính hợp lệ của định dạng mã: Phải dài 7 ký tự, bắt đầu bằng 'C' và theo sau là số
    if (code.length !== 7 || !code.startsWith('C') || isNaN(code.substring(1))) {
        alert("Vui lòng nhập đúng định dạng mã nhận file! (Ví dụ: C112233)");
        return;
    }
    
    statusText.innerText = "Đang kết nối từ xa...";
    progressSection.classList.add('active');

    // Thiết lập kênh truyền dữ liệu an toàn đến máy chủ Peer đích thông qua mã định danh đầy đủ
    connection = peer.connect(APP_PREFIX + code, {
        reliable: true
    });
    
    setupConnectionListeners();
});

// --- 5. GIÁM SÁT TIẾN TRÌNH TRUYỀN TẢI FILE DỮ LIỆU SỬ DỤNG WEBRTC ---
function setupConnectionListeners() {
    connection.on('open', () => {
        progressSection.classList.add('active');
        
        // Kiểm tra vai trò: Nếu tồn tại bộ nhớ đệm file => Đây là máy phát dữ liệu đi
        if (selectedFile) {
            statusText.innerText = "Đang truyền file...";
            
            // Tiến hành ép kiểu và truyền mảng dữ liệu thô nhị phân trực tiếp (P2P DataChannel)
            connection.send({
                name: selectedFile.name,
                size: selectedFile.size,
                type: selectedFile.type,
                data: selectedFile
            });
            
            simulateProgress();
        } else {
            statusText.innerText = "Đang đợi phản hồi file...";
        }
    });

    connection.on('data', (data) => {
        // Nhận luồng dữ liệu nhị phân từ kênh truyền trực tiếp (Dành cho máy nhận)
        if (data && data.data) {
            statusText.innerText = "Đang tải dữ liệu về...";
            updateProgressBar(50); // Đánh dấu hoàn tất nhận luồng dữ liệu thô

            // Tái cấu trúc gói tin thô thành định dạng File gốc của hệ thống
            const blob = new Blob([data.data], { type: data.type });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = data.name;
            
            // Cập nhật trạng thái đồ họa lên mức tối đa và kích hoạt lệnh lưu file trên trình duyệt
            updateProgressBar(100);
            statusText.innerText = "Đã nhận thành công!";
            link.click();
        }
    });

    connection.on('close', () => {
        statusText.innerText = "Kết nối đã ngắt.";
    });
}

// Hàm xử lý đồ họa thanh tiến trình % trực quan
function updateProgressBar(percent) {
    progressBar.style.width = percent + "%";
    statusPercent.innerText = percent + "%";
}

// Đồng bộ hóa trạng thái giả lập cho tiến trình gửi dữ liệu băng thông rộng
function simulateProgress() {
    let current = 0;
    const interval = setInterval(() => {
        current += 10;
        if (current <= 90) {
            updateProgressBar(current);
        }
        if (current >= 100 && statusText.innerText === "Đã nhận thành công!") {
            updateProgressBar(100);
            clearInterval(interval);
        }
    }, 150);
}

// Hàm bổ trợ tính toán và hiển thị đơn vị dung lượng file hệ thống một cách chính xác
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}