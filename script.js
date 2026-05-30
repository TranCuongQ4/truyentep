// --- 1. CHẶN CHUỘT PHẢI CẤP ĐỘ TRÌNH DUYỆT & PHÍM TẮT F12/QUÉT KHỐI ---
document.addEventListener('contextmenu', event => event.preventDefault());
document.addEventListener('keydown', (e) => {
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
    const random6Digits = Math.floor(100000 + Math.random() * 900000).toString();
    myShortCode = "C" + random6Digits; 
    
    peer = new Peer(APP_PREFIX + myShortCode, {
        config: {
            'iceServers': [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ]
        },
        debug: 1 // Chỉ hiện lỗi nghiêm trọng để tối ưu hiệu năng
    });

    peer.on('open', (id) => {
        myIdEl.innerText = myShortCode;
        console.log("Hệ thống kết nối thành công với ID ngầm: " + id);
    });

    peer.on('error', (err) => {
        console.error("Lỗi hệ thống: ", err.type);
        if (err.type === 'unavailable-id') {
            initPeerWithRetry();
        } else {
            statusText.innerText = "Lỗi kết nối mạng!";
        }
    });

    // XỬ LÝ DÀNH CHO PHÍA GỬI: Lắng nghe khi có máy nhận chủ động kết nối tới
    peer.on('connection', (conn) => {
        connection = conn;
        
        // Kích hoạt khu vực hiển thị tiến trình trên máy gửi
        progressSection.classList.add('active');
        statusText.innerText = "Đang kết nối với thiết bị nhận...";

        // Khi kênh truyền thực sự thông suốt, máy gửi chủ động đẩy file đi ngay lập tức
        connection.on('open', () => {
            if (selectedFile) {
                statusText.innerText = "Đang truyền file...";
                
                connection.send({
                    name: selectedFile.name,
                    size: selectedFile.size,
                    type: selectedFile.type,
                    data: selectedFile
                });
                
                simulateProgress();
            } else {
                statusText.innerText = "Kết nối lỗi: Chưa chọn file cần gửi!";
            }
        });

        connection.on('close', () => {
            statusText.innerText = "Kết nối đã ngắt.";
        });
    });
}

initPeerWithRetry();

// --- 3. XỬ LÝ LOGIC PHÍA GỬI FILE ---
fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        selectedFile = e.target.files[0];
        fileInfo.innerText = `${selectedFile.name} (${formatBytes(selectedFile.size)})`;
        
        generatedCodeEl.innerText = myShortCode;
        codeBox.style.display = "block";
    }
});

// --- 4. XỬ LÝ LOGIC PHÍA NHẬN FILE ---
connectBtn.addEventListener('click', () => {
    let code = receiveInput.value.trim();
    code = code.toUpperCase(); 

    if (code.length !== 7 || !code.startsWith('C') || isNaN(code.substring(1))) {
        alert("Vui lòng nhập đúng định dạng mã nhận file! (Ví dụ: C112233)");
        return;
    }
    
    statusText.innerText = "Đang kết nối từ xa...";
    progressSection.classList.add('active');

    // Thiết lập kết nối từ máy nhận sang máy gửi
    connection = peer.connect(APP_PREFIX + code, {
        reliable: true
    });
    
    // XỬ LÝ DÀNH CHO PHÍA NHẬN: Lắng nghe luồng dữ liệu đổ về
    connection.on('open', () => {
        statusText.innerText = "Đang kết nối thành công! Chờ nhận dữ liệu...";
        updateProgressBar(10);
    });

    connection.on('data', (data) => {
        if (data && data.data) {
            statusText.innerText = "Đang tải dữ liệu về...";
            updateProgressBar(60); 

            // Chuyển mảng dữ liệu thô thành file gốc và kích hoạt tải về máy
            const blob = new Blob([data.data], { type: data.type });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = data.name;
            
            updateProgressBar(100);
            statusText.innerText = "Đã nhận thành công!";
            link.click();
        }
    });

    connection.on('close', () => {
        statusText.innerText = "Kết nối đã ngắt.";
    });
});

// --- 5. CÁC HÀM TIỆN ÍCH HỖ TRỢ ĐỒ HỌA GIAO DIỆN ---
function updateProgressBar(percent) {
    progressBar.style.width = percent + "%";
    statusPercent.innerText = percent + "%";
}

function simulateProgress() {
    let current = 0;
    const interval = setInterval(() => {
        current += 10;
        if (current <= 90) {
            updateProgressBar(current);
        }
        // Khi máy gửi đẩy xong lên luồng dữ liệu, tự treo ở mức 95% đợi máy nhận báo hoàn tất
        if (current >= 100) {
            updateProgressBar(95);
            statusText.innerText = "Đã gửi dữ liệu đi!";
            clearInterval(interval);
        }
    }, 80);
}

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}