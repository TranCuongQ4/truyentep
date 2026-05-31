// =====================================================
// FIREBASE IMPORT
// =====================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
    getDatabase,
    ref,
    set,
    get,
    update,
    push,
    onValue,
    remove
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-database.js";

// =====================================================
// FIREBASE CONFIG
// =====================================================
const firebaseConfig = {
    apiKey: "AIzaSyCwgBsmd9GFtIp3LD_aBV_VYZCheb2CvgI",
    authDomain: "cuongdata.firebaseapp.com",
    databaseURL: "https://cuongdata-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "cuongdata",
    storageBucket: "cuongdata.firebasestorage.app",
    messagingSenderId: "10726452052",
    appId: "1:10726452052:web:fc724b6775f492cdf136c1",
    measurementId: "G-PJJMR87MTJ"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// =====================================================
// DOM ELEMENTS
// =====================================================
const fileInput = document.getElementById("fileInput");
const createRoomBtn = document.getElementById("createRoomBtn");
const joinRoomBtn = document.getElementById("joinRoomBtn");
const roomInput = document.getElementById("roomInput");
const roomCode = document.getElementById("roomCode");
const fileName = document.getElementById("fileName");
const connectionStatus = document.getElementById("connectionStatus");
const progressBar = document.getElementById("progressBar");
const progressPercent = document.getElementById("progressPercent");
const transferSize = document.getElementById("transferSize");
const transferSpeed = document.getElementById("transferSpeed");
const remainingTime = document.getElementById("remainingTime");
const transferMode = document.getElementById("transferMode");
const logBox = document.getElementById("logBox");
const toast = document.getElementById("toast");

// =====================================================
// GLOBAL VARIABLES
// =====================================================
let selectedFile = null;
let roomId = null;
let isSender = false;
let peerConnection = null;
let dataChannel = null;
let receiveBuffers = [];
let receiveSize = 0;
let expectedFileSize = 0;
let expectedFileName = "";
let transferStartTime = 0;
let unsubscribeAnswer = null;
let connectionTimeout = null;

// =====================================================
// CONFIG WEBRTC: Tích hợp STUN + TURN bảo đảm xuyên tường lửa
// =====================================================
const rtcConfig = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        // Sử dụng cụm TURN Server Public hiệu năng cao miễn phí để trung chuyển dữ liệu khi P2P bị chặn
        {
            urls: "turn:openrelay.metered.ca:80",
            username: "openrelayproject",
            credential: "openrelayproject"
        },
        {
            urls: "turn:openrelay.metered.ca:443",
            username: "openrelayproject",
            credential: "openrelayproject"
        }
    ],
    iceCandidatePoolSize: 10
};

// =====================================================
// LOGGING & UI HELPERS
// =====================================================
function addLog(text) {
    const time = new Date().toLocaleTimeString();
    logBox.innerHTML += `<div>[${time}] ${text}</div>`;
    logBox.scrollTop = logBox.scrollHeight;
    console.log(text);
}

function showToast(text) {
    toast.textContent = text;
    toast.classList.add("show");
    setTimeout(() => {
        toast.classList.remove("show");
    }, 3000);
}

function setStatus(text, color = "#22c55e") {
    connectionStatus.textContent = text;
    connectionStatus.style.color = color;
    addLog(text);
}

function generateRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
}

// =====================================================
// FILE SELECTION
// =====================================================
fileInput.addEventListener("change", () => {
    if (!fileInput.files.length) return;
    selectedFile = fileInput.files[0];
    fileName.textContent = `${selectedFile.name} (${formatSize(selectedFile.size)})`;
    addLog(`Đã chọn file chuẩn bị gửi: ${selectedFile.name}`);
});

// =====================================================
// ACTION SENDER: CREATE ROOM
// =====================================================
createRoomBtn.addEventListener("click", async () => {
    if (!selectedFile || selectedFile.size === 0) {
        showToast("Vui lòng chọn file trước khi tạo phòng!");
        return;
    }

    isSender = true;
    roomId = generateRoomCode();
    roomCode.textContent = roomId;

    setStatus("Đang khởi tạo cấu hình phòng...", "#facc15");

    try {
        const roomRef = ref(db, `rooms/${roomId}`);
        await set(roomRef, {
            createdAt: Date.now(),
            status: "waiting"
        });

        addLog(`Đã tạo phòng thành công trên DB: ${roomId}`);
        setStatus("Đang chờ thiết bị nhận kết nối...", "#facc15");

        await createSenderPeer();
        watchConnectionState();
    } catch (error) {
        console.error(error);
        setStatus("Lỗi khởi tạo phòng!", "#ef4444");
    }
});

async function createSenderPeer() {
    peerConnection = new RTCPeerConnection(rtcConfig);

    dataChannel = peerConnection.createDataChannel("fileTransfer", { ordered: true });
    setupDataChannel();

    peerConnection.onicecandidate = async (event) => {
        if (!event.candidate) return;
        try {
            const candidateRef = push(ref(db, `rooms/${roomId}/offerCandidates`));
            await set(candidateRef, event.candidate.toJSON());
        } catch (e) {
            console.error("Lỗi đồng bộ hóa ICE (Sender):", e);
        }
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    await update(ref(db, `rooms/${roomId}`), {
        offer: {
            type: offer.type,
            sdp: offer.sdp
        }
    });

    addLog("Đã tạo và gửi cấu hình WebRTC Offer lên Signaling");
    listenForAnswer();
}

function listenForAnswer() {
    const roomRef = ref(db, `rooms/${roomId}`);
    unsubscribeAnswer = onValue(roomRef, async (snapshot) => {
        const data = snapshot.val();
        if (!data || !data.answer) return;

        if (peerConnection.currentRemoteDescription || peerConnection.signalingState === "stable") return;

        try {
            if (unsubscribeAnswer) {
                unsubscribeAnswer();
                unsubscribeAnswer = null;
            }

            startConnectionTimeout();

            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            addLog("Đã nhận diện luồng kết nối ngược lại của thiết bị nhận");
        } catch (err) {
            console.error("Lỗi đồng bộ RemoteDescription (Sender):", err);
        }
    });

    const answerCandidatesRef = ref(db, `rooms/${roomId}/answerCandidates`);
    onValue(answerCandidatesRef, async (snapshot) => {
        snapshot.forEach(async (child) => {
            const candidate = child.val();
            try {
                if (peerConnection.remoteDescription) {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                }
            } catch (err) {
                console.error("Lỗi gán ICE Candidate (Sender):", err);
            }
        });
    });
}

// =====================================================
// ACTION RECEIVER: JOIN ROOM
// =====================================================
joinRoomBtn.addEventListener("click", async () => {
    const code = roomInput.value.trim().toUpperCase();
    if (!code || code.length !== 6) {
        showToast("Vui lòng nhập chính xác mã phòng 6 ký tự!");
        return;
    }

    roomId = code;
    setStatus("Đang tìm phòng trên hệ thống...", "#facc15");

    const roomRef = ref(db, `rooms/${roomId}`);
    const snap = await get(roomRef);

    if (!snap.exists()) {
        showToast("Phòng không tồn tại hoặc đã hết hạn!");
        setStatus("Không tìm thấy phòng", "#ef4444");
        return;
    }

    addLog(`Đã xác thực phòng: ${roomId}. Tiến hành kết nối...`);
    await joinAsReceiver();
    watchConnectionState();
    startConnectionTimeout();
});

async function joinAsReceiver() {
    const roomData = (await get(ref(db, `rooms/${roomId}`))).val();
    if (!roomData || !roomData.offer) {
        showToast("Phòng này chưa sẵn sàng luồng truyền dữ liệu!");
        return;
    }

    isSender = false;
    peerConnection = new RTCPeerConnection(rtcConfig);

    peerConnection.ondatachannel = (event) => {
        dataChannel = event.channel;
        setupDataChannel();
        addLog("Kênh DataChannel đồng bộ thành công phía Người Nhận");
    };

    peerConnection.onicecandidate = async (event) => {
        if (!event.candidate) return;
        try {
            const candidateRef = push(ref(db, `rooms/${roomId}/answerCandidates`));
            await set(candidateRef, event.candidate.toJSON());
        } catch (e) {
            console.error("Lỗi đồng bộ hóa ICE (Receiver):", e);
        }
    };

    await peerConnection.setRemoteDescription(new RTCSessionDescription(roomData.offer));
    addLog("Xử lý cấu hình Offer thành công");

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    await update(ref(db, `rooms/${roomId}`), {
        answer: {
            type: answer.type,
            sdp: answer.sdp
        },
        status: "connected"
    });

    addLog("Đã phản hồi cấu hình WebRTC Answer lên hệ thống");
    listenOfferCandidates();
}

function listenOfferCandidates() {
    const offerCandidatesRef = ref(db, `rooms/${roomId}/offerCandidates`);
    onValue(offerCandidatesRef, async (snapshot) => {
        snapshot.forEach(async (child) => {
            const candidate = child.val();
            try {
                if (peerConnection.remoteDescription) {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                }
            } catch (err) {
                console.error("Lỗi gán ICE Candidate (Receiver):", err);
            }
        });
    });
}

// =====================================================
// MONITOR STATE CHANGES
// =====================================================
function watchConnectionState() {
    peerConnection.onconnectionstatechange = () => {
        const state = peerConnection.connectionState;
        addLog(`Trạng thái kênh băng thông: ${state.toUpperCase()}`);

        switch (state) {
            case "connected":
                clearConnectionTimeout();
                setStatus("Đã Kết Nối Trực Tiếp", "#22c55e");
                break;
            case "connecting":
                setStatus("Đang Bắt Tay Thiết Bị...", "#facc15");
                break;
            case "disconnected":
                setStatus("Mất Kết Nối Băng Thông", "#ef4444");
                break;
            case "failed":
                setStatus("Kết Nối Thất Bại (Thử lại)", "#ef4444");
                clearConnectionTimeout();
                break;
            case "closed":
                setStatus("Đã Đóng Kết Nối", "#94a3b8");
                break;
        }
    };
}

// =====================================================
// DATA CHANNEL HANDLING (CORE TRANSFER)
// =====================================================
function setupDataChannel() {
    if (!dataChannel) return;
    dataChannel.binaryType = "arraybuffer";

    dataChannel.onopen = () => {
        addLog("Đường ống dữ liệu (DataChannel) đã mở thông suốt");
        if (isSender && selectedFile) {
            // Delay 1 giây đảm bảo luồng buffer ổn định trước khi bắn dữ liệu thô
            setTimeout(() => {
                sendFile();
            }, 1000);
        }
    };

    dataChannel.onclose = () => {
        addLog("Đường ống dữ liệu đã tự động đóng");
    };

    dataChannel.onerror = (err) => {
        console.error("Lỗi kênh truyền dữ liệu:", err);
        addLog("Xuất hiện lỗi trong quá trình truyền dữ liệu mạng");
    };

    dataChannel.onmessage = handleIncomingData;
}

// Phía nhận xử lý gói dữ liệu truyền tới
function handleIncomingData(event) {
    if (typeof event.data === "string") {
        const msg = JSON.parse(event.data);

        if (msg.type === "metadata") {
            expectedFileName = msg.name;
            expectedFileSize = msg.size;
            receiveBuffers = [];
            receiveSize = 0;
            transferStartTime = Date.now();
            transferMode.textContent = "Nhận File";
            addLog(`Bắt đầu tiến trình tải về: ${msg.name}`);
            return;
        }

        if (msg.type === "complete") {
            finishDownload();
            return;
        }
        return;
    }

    // Nhận các khối nhị phân ArrayBuffer
    receiveBuffers.push(event.data);
    receiveSize += event.data.byteLength;

    updateReceiveProgress();
}

// Cập nhật giao diện bên nhận
function updateReceiveProgress() {
    if (!expectedFileSize) return;

    const percent = Math.floor((receiveSize / expectedFileSize) * 100);
    progressBar.style.width = `${percent}%`;
    progressPercent.textContent = `${percent}%`;
    transferSize.textContent = `${formatSize(receiveSize)} / ${formatSize(expectedFileSize)}`;

    const elapsed = (Date.now() - transferStartTime) / 1000;
    const speed = elapsed > 0 ? receiveSize / elapsed : 0;
    transferSpeed.textContent = `${formatSize(speed)}/s`;

    const remain = speed > 0 ? (expectedFileSize - receiveSize) / speed : 0;
    remainingTime.textContent = formatTime(remain);
}

function finishDownload() {
    const blob = new Blob(receiveBuffers);
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement("a");
    a.href = url;
    a.download = expectedFileName;
    a.click();
    
    URL.revokeObjectURL(url);

    progressBar.style.width = "100%";
    progressPercent.textContent = "100%";
    addLog(`Đã tải xuống thành công file: ${expectedFileName}`);
    showToast("Nhận file hoàn tất!");
    setStatus("Nhận Thành Công", "#22c55e");

    setTimeout(async () => {
        await cleanupRoom();
        resetTransfer();
    }, 4000);
}

// Phía gửi xử lý đọc và đẩy dữ liệu ra kênh truyền
async function sendFile() {
    if (!selectedFile) return;

    transferMode.textContent = "Gửi File";
    transferStartTime = Date.now();

    // Bước 1: Gửi thông tin định dạng file (Metadata)
    dataChannel.send(JSON.stringify({
        type: "metadata",
        name: selectedFile.name,
        size: selectedFile.size
    }));

    addLog("Đang phân tích dữ liệu và bắt đầu đẩy gói tin...");

    const chunkSize = 16 * 1024; // Kích thước khối dữ liệu chuẩn 16KB tối ưu băng thông WebRTC
    let offset = 0;

    // Đọc file theo dạng luồng nhị phân tuần tự
    while (offset < selectedFile.size) {
        const slice = selectedFile.slice(offset, offset + chunkSize);
        const buffer = await slice.arrayBuffer();
        
        dataChannel.send(buffer);
        offset += buffer.byteLength;

        updateSendProgress(offset, selectedFile.size);

        // Chống tràn bộ nhớ đệm kênh truyền WebRTC (Buffer Overflow)
        if (dataChannel.bufferedAmount > 1024 * 1024) {
            await new Promise(resolve => setTimeout(resolve, 20));
        }
    }

    // Bước 2: Gửi tín hiệu báo hoàn thành
    dataChannel.send(JSON.stringify({ type: "complete" }));

    addLog("Tất cả gói dữ liệu đã được đẩy đi hoàn tất");
    showToast("Gửi dữ liệu hoàn tất!");
    setStatus("Gửi Thành Công", "#22c55e");

    setTimeout(async () => {
        await cleanupRoom();
        resetTransfer();
    }, 4000);
}

function updateSendProgress(sent, total) {
    const percent = Math.floor((sent / total) * 100);
    progressBar.style.width = `${percent}%`;
    progressPercent.textContent = `${percent}%`;
    transferSize.textContent = `${formatSize(sent)} / ${formatSize(total)}`;

    const elapsed = (Date.now() - transferStartTime) / 1000;
    const speed = elapsed > 0 ? sent / elapsed : 0;
    transferSpeed.textContent = `${formatSize(speed)}/s`;

    const remain = speed > 0 ? (total - sent) / speed : 0;
    remainingTime.textContent = formatTime(remain);
}

// =====================================================
// UTILS & CLEANUP FUNCTIONS
// =====================================================
function formatSize(bytes) {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function formatTime(sec) {
    sec = Math.floor(sec);
    if (sec <= 0) return "0s";
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function startConnectionTimeout() {
    clearConnectionTimeout();
    connectionTimeout = setTimeout(() => {
        if (!peerConnection || peerConnection.connectionState !== "connected") {
            setStatus("Quá thời gian kết nối (Timeout)", "#ef4444");
            showToast("Không thể kết nối đến thiết bị bên kia!");
            addLog("Lỗi: Quá thời gian bắt tay WebRTC (60s)");
        }
    }, 60000); // 60 giây chờ thiết bị kết nối ổn định xuyên lục địa
}

function clearConnectionTimeout() {
    if (connectionTimeout) {
        clearTimeout(connectionTimeout);
        connectionTimeout = null;
    }
}

async function cleanupRoom() {
    try {
        if (roomId) {
            await remove(ref(db, `rooms/${roomId}`));
            addLog("Hệ thống đã tự động dọn dẹp và xóa phòng trên DB");
            roomId = null;
        }
    } catch (err) {
        console.error("Lỗi dọn dẹp phòng:", err);
    }
}

function resetTransfer() {
    receiveBuffers = [];
    receiveSize = 0;
    expectedFileSize = 0;
    expectedFileName = "";
    
    progressBar.style.width = "0%";
    progressPercent.textContent = "0%";
    transferSize.textContent = "0 B / 0 B";
    transferSpeed.textContent = "0 KB/s";
    remainingTime.textContent = "--";
    transferMode.textContent = "Idle";
    
    if (unsubscribeAnswer) {
        unsubscribeAnswer();
        unsubscribeAnswer = null;
    }
}

// Tự động dọn dẹp phòng nếu người dùng tắt tab đột ngột
window.addEventListener("beforeunload", () => {
    cleanupRoom();
});