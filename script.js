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
// DOM
// =====================================================

const fileInput = document.getElementById("fileInput");

const createRoomBtn = document.getElementById("createRoomBtn");

const joinRoomBtn = document.getElementById("joinRoomBtn");

const roomInput = document.getElementById("roomInput");

const roomCode = document.getElementById("roomCode");

const fileName = document.getElementById("fileName");

const connectionStatus =
document.getElementById("connectionStatus");

const progressBar =
document.getElementById("progressBar");

const progressPercent =
document.getElementById("progressPercent");

const transferSize =
document.getElementById("transferSize");

const transferSpeed =
document.getElementById("transferSpeed");

const remainingTime =
document.getElementById("remainingTime");

const transferMode =
document.getElementById("transferMode");

const logBox =
document.getElementById("logBox");

const toast =
document.getElementById("toast");

const qrCanvas =
document.getElementById("qrCanvas");


// =====================================================
// GLOBAL
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


// =====================================================
// ICE SERVERS 
// =====================================================

const rtcConfig = {

    iceServers: [

        {
            urls: [
                "stun:stun.l.google.com:19302",
                "stun:stun1.l.google.com:19302",
                "stun:stun2.l.google.com:19302",
                "stun:stun3.l.google.com:19302",
                "stun:stun4.l.google.com:19302"
            ]
        }

    ],
    iceCandidatePoolSize: 10
};


// =====================================================
// LOG
// =====================================================

function addLog(text){

    const time =
    new Date().toLocaleTimeString();

    logBox.innerHTML +=
    `<div>[${time}] ${text}</div>`;

    logBox.scrollTop =
    logBox.scrollHeight;

    console.log(text);
}


// =====================================================
// TOAST
// =====================================================

function showToast(text){

    toast.textContent = text;

    toast.classList.add("show");

    setTimeout(() => {

        toast.classList.remove("show");

    },3000);
}


// =====================================================
// STATUS
// =====================================================

function setStatus(text,color="#22c55e"){

    connectionStatus.textContent = text;

    connectionStatus.style.color = color;

    addLog(text);
}


// =====================================================
// RANDOM ROOM
// =====================================================

function generateRoomCode(){

    const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    let code = "";

    for(let i=0;i<6;i++){

        code +=
        chars[Math.floor(
        Math.random()*chars.length
        )];
    }

    return code;
}


// =====================================================
// FILE SELECT
// =====================================================

fileInput.addEventListener(
"change",
() => {

    if(!fileInput.files.length)
        return;

    selectedFile =
    fileInput.files[0];

    fileName.textContent =
    selectedFile.name;

    addLog(
    `Đã chọn file: ${selectedFile.name}`
    );

});

// =====================================================
// QR CODE (Sửa dứt điểm lỗi CORS bằng phương pháp nạp Ảnh qua API Google)
// =====================================================

function createQRCode(code){

    return new Promise((resolve, reject) => {
        try {
            const ctx = qrCanvas.getContext("2d");
            const img = new Image();
            
            // Thiết lập kích thước Canvas đồng bộ với CSS
            qrCanvas.width = 180;
            qrCanvas.height = 180;

            img.crossOrigin = "anonymous"; 
            
            // Sử dụng API tạo mã QR tĩnh, an toàn, không phụ thuộc thư viện JS ngoại vi
            img.src = `https://chart.googleapis.com/chart?chs=180x180&cht=qr&chl=${encodeURIComponent(code)}&choe=UTF-8`;

            img.onload = () => {
                ctx.clearRect(0, 0, qrCanvas.width, qrCanvas.height);
                ctx.drawImage(img, 0, 0, 180, 180);
                addLog("Đã tạo ảnh QR thành công.");
                resolve();
            };

            img.onerror = (e) => {
                console.error(e);
                addLog("Lỗi tải ảnh QR từ máy chủ, bỏ qua.");
                reject(e);
            };

        } catch (err) {
            console.error(err);
            addLog("Không thể khởi tạo vùng vẽ QR Code.");
            reject(err);
        }
    });
}


// =====================================================
// CREATE ROOM
// =====================================================

createRoomBtn.addEventListener(
"click",
async () => {

    if(
    !selectedFile ||
    selectedFile.size === 0
){

        showToast(
        "Vui lòng chọn file trước"
        );

        return;
    }

    isSender = true;

    roomId =
    generateRoomCode();

    roomCode.textContent =
    roomId;

    // Chạy vẽ QR Code song song không làm treo luồng logic chính
    createQRCode(roomId).catch(e => console.log(e));

    setStatus(
    "Đang tạo phòng..."
    );

    const roomRef =
    ref(
        db,
        `rooms/${roomId}`
    );

    await set(
        roomRef,
        {
            createdAt: Date.now(),
            status: "waiting"
        }
    );

    addLog(
    `Đã tạo phòng ${roomId}`
    );

    setStatus(
    "Đang chờ người nhận..."
    );

    await createSenderPeer();
	
	watchConnectionState();
	
	startConnectionTimeout();

});

// =====================================================
// SENDER PEER
// =====================================================

async function createSenderPeer(){

    peerConnection =
    new RTCPeerConnection(
        rtcConfig
    );

    dataChannel =
    peerConnection.createDataChannel(
        "fileTransfer",
        { ordered: true }
    );

    setupDataChannel();

    peerConnection.onicecandidate =
    async (event) => {

        if(!event.candidate)
            return;

        const candidateRef =
        push(
            ref(
                db,
                `rooms/${roomId}/offerCandidates`
            )
        );

        await set(
            candidateRef,
            event.candidate.toJSON()
        );
    };


    const offer =
    await peerConnection.createOffer();

    await peerConnection.setLocalDescription(
        offer
    );

    await update(

        ref(
            db,
            `rooms/${roomId}`
        ),

        {
            offer: {

                type:
                offer.type,

                sdp:
                offer.sdp
            }
        }

    );

    addLog(
    "Đã tạo WebRTC Offer"
    );

    listenForAnswer();
}

// =====================================================
// LISTEN ANSWER
// =====================================================

function listenForAnswer(){

    const roomRef =
    ref(
        db,
        `rooms/${roomId}`
    );

    onValue(
        roomRef,
        async(snapshot)=>{

            const data =
            snapshot.val();

            if(
                !data ||
                !data.answer
            ){
                return;
            }

            if(
                peerConnection
                .currentRemoteDescription
            ){
                return;
            }

            await peerConnection
            .setRemoteDescription(

                new RTCSessionDescription(
                    data.answer
                )

            );

            addLog(
            "Người nhận đã kết nối"
            );

            setStatus(
            "Đã kết nối",
            "#22c55e"
            );

        }
    );


    const answerCandidatesRef =
    ref(
        db,
        `rooms/${roomId}/answerCandidates`
    );

    onValue(
        answerCandidatesRef,
        async(snapshot)=>{

            snapshot.forEach(
                async(child)=>{

                    const candidate =
                    child.val();

                    try{

                        await peerConnection
                        .addIceCandidate(
                            new RTCIceCandidate(
                                candidate
                            )
                        );

                    }catch(err){

                        console.error(err);
                    }

                }
            );

        }
    );

}

// =====================================================
// JOIN ROOM
// =====================================================

joinRoomBtn.addEventListener(
"click",
async()=>{

    const code =
    roomInput.value
    .trim()
    .toUpperCase();

    if(!code){

        showToast(
        "Nhập mã phòng"
        );

        return;
    }

    roomId = code;

    setStatus(
    "Đang tìm phòng...",
    "#facc15"
    );

    const roomRef =
    ref(
        db,
        `rooms/${roomId}`
    );

    const snap =
    await get(roomRef);

    if(!snap.exists()){

        showToast(
        "Không tìm thấy phòng"
        );

        setStatus(
        "Không tìm thấy",
        "#ef4444"
        );

        return;
    }

    addLog(
    `Đã tìm thấy phòng ${roomId}`
    );

    await joinAsReceiver();
	
	watchConnectionState();
	
	startConnectionTimeout();

});

// =====================================================
// RECEIVER PEER
// =====================================================

async function joinAsReceiver(){

    const roomData =
    (
        await get(
            ref(
                db,
                `rooms/${roomId}`
            )
        )
    ).val();

    if(
        !roomData ||
        !roomData.offer
    ){

        showToast(
        "Phòng chưa sẵn sàng"
        );

        return;
    }

    peerConnection =
    new RTCPeerConnection(
        rtcConfig
    );

    peerConnection.ondatachannel =
    (event)=>{

        dataChannel =
        event.channel;

        setupDataChannel();

        addLog(
        "DataChannel đã mở"
        );

    };

    peerConnection.onicecandidate =
    async(event)=>{

        if(!event.candidate)
            return;

        const candidateRef =
        push(
            ref(
                db,
                `rooms/${roomId}/answerCandidates`
            )
        );

        await set(
            candidateRef,
            event.candidate.toJSON()
        );
    };

    await peerConnection
    .setRemoteDescription(

        new RTCSessionDescription(
            roomData.offer
        )

    );

    addLog(
    "Đã nhận Offer"
    );

    const answer =
    await peerConnection
    .createAnswer();

    await peerConnection
    .setLocalDescription(
        answer
    );

    await update(

        ref(
            db,
            `rooms/${roomId}`
        ),

        {
            answer:{
                type:answer.type,
                sdp:answer.sdp
            },

            status:"connected"
        }

    );

    addLog(
    "Đã gửi Answer"
    );

    setStatus(
    "Đang kết nối...",
    "#22c55e"
    );

    listenOfferCandidates();
}

// =====================================================
// OFFER CANDIDATES
// =====================================================

function listenOfferCandidates(){

    const offerCandidatesRef =
    ref(
        db,
        `rooms/${roomId}/offerCandidates`
    );

    onValue(
        offerCandidatesRef,
        async(snapshot)=>{

            snapshot.forEach(
                async(child)=>{

                    const candidate =
                    child.val();

                    try{

                        await peerConnection
                        .addIceCandidate(

                            new RTCIceCandidate(
                                candidate
                            )

                        );

                    }catch(err){

                        console.error(err);
                    }

                }
            );

        }
    );
}

// =====================================================
// CONNECTION STATE
// =====================================================

function watchConnectionState(){

    peerConnection
    .onconnectionstatechange =
    ()=>{

        const state =
        peerConnection
        .connectionState;

        addLog(
        `State: ${state}`
        );

        switch(state){

            case "connected":
			
			    clearConnectionTimeout();

                setStatus(
                "Đã kết nối",
                "#22c55e"
                );

                break;

            case "connecting":

                setStatus(
                "Đang kết nối",
                "#facc15"
                );

                break;

            case "disconnected":

                setStatus(
                "Mất kết nối",
                "#ef4444"
                );

                break;

            case "failed":

                setStatus(
                "Kết nối lỗi",
                "#ef4444"
                );

                break;

            case "closed":

                setStatus(
                "Đã đóng",
                "#94a3b8"
                );

                break;
        }
    };
}


// =====================================================
// DATACHANNEL
// =====================================================

function setupDataChannel(){

    if(!dataChannel)
        return;

    dataChannel.binaryType =
    "arraybuffer";

    dataChannel.onopen =
    ()=>{

        addLog(
        "DataChannel OPEN"
        );

        setStatus(
        "Đã kết nối",
        "#22c55e"
        );

        if(
            isSender &&
            selectedFile
        ){

            setTimeout(()=>{

                sendFile();

            },1000);

        }
    };

    dataChannel.onclose =
    ()=>{

        addLog(
        "DataChannel CLOSED"
        );

        setStatus(
        "Đã ngắt kết nối",
        "#ef4444"
        );
    };

    dataChannel.onerror =
    (err)=>{

        console.error(err);

        addLog(
        "Lỗi DataChannel"
        );
    };

    dataChannel.onmessage =
    handleIncomingData;
}

// =====================================================
// RECEIVE
// =====================================================

function handleIncomingData(
event
){

    if(
        typeof event.data
        === "string"
    ){

        const msg =
        JSON.parse(
            event.data
        );

        if(
            msg.type ===
            "metadata"
        ){

            expectedFileName =
            msg.name;

            expectedFileSize =
            msg.size;

            receiveBuffers =
            [];

            receiveSize = 0;

            transferMode
            .textContent =
            "Nhận";

            addLog(
            `Nhận file: ${msg.name}`
            );

            return;
        }

        if(
            msg.type ===
            "complete"
        ){

            finishDownload();

            return;
        }

        return;
    }

    receiveBuffers.push(
        event.data
    );

    receiveSize +=
    event.data.byteLength;

    updateReceiveProgress();
}

// =====================================================
// RECEIVE PROGRESS
// =====================================================

function updateReceiveProgress(){

    if(
        !expectedFileSize
    ) return;

    const percent =
    Math.floor(

        receiveSize
        /
        expectedFileSize
        *
        100

    );

    progressBar.style.width =
    percent + "%";

    progressPercent.textContent =
    percent + "%";

    transferSize.textContent =

    formatSize(
        receiveSize
    )

    + " / " +

    formatSize(
        expectedFileSize
    );
}

// =====================================================
// DOWNLOAD
// =====================================================

function finishDownload(){

    const blob =
    new Blob(
        receiveBuffers
    );

    const url =
    URL.createObjectURL(
        blob
    );

    const a =
    document.createElement(
        "a"
    );

    a.href = url;

    a.download =
    expectedFileName;

    a.click();

    URL.revokeObjectURL(
        url
    );

    progressBar.style.width =
    "100%";

    progressPercent.textContent =
    "100%";

    addLog(
    "Tải file hoàn tất"
    );

    showToast(
    "Đã nhận file"
    );

    setStatus(
    "Nhận thành công",
    "#22c55e"
    );
	
	setTimeout(async()=>{

    await cleanupRoom();

    resetTransfer();

},5000);

}

// =====================================================
// SEND FILE
// =====================================================

async function sendFile(){

    if(
        !selectedFile
    ) return;

    transferMode
    .textContent =
    "Gửi";

    transferStartTime =
    Date.now();

    dataChannel.send(

        JSON.stringify({

            type:"metadata",

            name:
            selectedFile.name,

            size:
            selectedFile.size

        })

    );

    addLog(
    "Bắt đầu gửi..."
    );

    const chunkSize =
    16 * 1024; 

    let offset = 0;

    while(
        offset <
        selectedFile.size
    ){

        const slice =
        selectedFile.slice(
            offset,
            offset +
            chunkSize
        );

        const buffer =
        await slice.arrayBuffer();

        dataChannel.send(
            buffer
        );

        offset +=
        buffer.byteLength;

        updateSendProgress(
            offset,
            selectedFile.size
        );

        while(
            dataChannel
            .bufferedAmount >
            1024 * 1024
        ){

            await new Promise(
                r =>
                setTimeout(
                    r,
                    30
                )
            );
        }
    }

    dataChannel.send(

        JSON.stringify({

            type:"complete"

        })

    );

    addLog(
    "Gửi hoàn tất"
    );

    showToast(
    "Đã gửi xong"
    );

    setStatus(
    "Gửi thành công",
    "#22c55e"
    );
	
	setTimeout(async()=>{

    await cleanupRoom();

    resetTransfer();

},5000);

}

// =====================================================
// SEND PROGRESS
// =====================================================

function updateSendProgress(
sent,
total
){

    const percent =
    Math.floor(
        sent /
        total *
        100
    );

    progressBar.style.width =
    percent + "%";

    progressPercent.textContent =
    percent + "%";

    transferSize.textContent =

    formatSize(sent)

    + " / " +

    formatSize(total);

    const elapsed =

    (
        Date.now()
        -
        transferStartTime
    )
    /1000;

    const speed =
    sent /
    elapsed;

    transferSpeed.textContent =

    formatSize(speed)
    + "/s";

    const remain =
    (
        total - sent
    )
    /
    Math.max(
        speed,
        1
    );

    remainingTime.textContent =
    formatTime(
        remain
    );
}

// =====================================================
// HELPERS
// =====================================================

function formatSize(
bytes
){

    if(
        bytes <
        1024
    ) return bytes+" B";

    if(
        bytes <
        1024*1024
    ){

        return (
            bytes/1024
        ).toFixed(1)
        +" KB";
    }

    if(
        bytes <
        1024*1024*1024
    ){

        return (
            bytes/
            1024/
            1024
        ).toFixed(1)
        +" MB";
    }

    return (
        bytes/
        1024/
        1024/
        1024
    ).toFixed(1)
    +" GB";
}

function formatTime(
sec
){

    sec =
    Math.floor(sec);

    const m =
    Math.floor(
        sec/60
    );

    const s =
    sec % 60;

    return (
        m+"m "
        +s+"s"
    );
}


// =====================================================
// CONNECTION TIMEOUT
// =====================================================

let connectionTimeout = null;

function startConnectionTimeout(){

    clearConnectionTimeout();

    connectionTimeout =
    setTimeout(()=>{

        if(
            !peerConnection ||
            peerConnection.connectionState !==
            "connected"
        ){

            setStatus(
            "Hết thời gian kết nối",
            "#ef4444"
            );

            showToast(
            "Không thể kết nối"
            );

            addLog(
            "Connection timeout"
            );
        }

    },30000);

}

function clearConnectionTimeout(){

    if(connectionTimeout){

        clearTimeout(
            connectionTimeout
        );

        connectionTimeout = null;
    }
}

// =====================================================
// ROOM CLEANUP
// =====================================================

async function cleanupRoom(){

    try{

        if(roomId){

            await remove(
                ref(
                    db,
                    `rooms/${roomId}`
                )
            );

            addLog(
            "Đã xóa phòng"
            );
        }

    }catch(err){

        console.error(err);
    }
}

// =====================================================
// MEMORY CLEANUP
// =====================================================

function resetTransfer(){

    receiveBuffers = [];

    receiveSize = 0;

    expectedFileSize = 0;

    expectedFileName = "";

    progressBar.style.width =
    "0%";

    progressPercent.textContent =
    "0%";

    transferSize.textContent =
    "0 MB";

    transferSpeed.textContent =
    "0 MB/s";

    remainingTime.textContent =
    "--";

    transferMode.textContent =
    "Idle";
}


// =====================================================
// PAGE CLOSE
// =====================================================

window.addEventListener(
"beforeunload",
async()=>{

    try{

        await cleanupRoom();

    }catch(err){

    }

});


// =====================================================
// APP START
// =====================================================

addLog(
"Firebase Ready"
);

addLog(
"WebRTC Ready"
);

setStatus(
"Sẵn sàng",
"#22c55e"
);

resetTransfer();