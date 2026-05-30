/**
         * P2P File Transfer - Fixed & Hardened Version
         * 
         * Fixes Applied:
         * 1. Connection Reliability: Ensures peers are fully registered before initiating connections.
         * 2. Data Transfer: Replaces raw File object sending with robust ArrayBuffer chunking to prevent data loss.
         * 3. Security: Sanitizes DOM updates to prevent XSS. Removes ineffective client-side restrictions.
         * 4. UI/UX: Adds granular status updates so users know exactly what is happening.
         * 5. Network: Adds free public TURN servers to bypass complex NATs (crucial for "connecting..." issues).
         */

        const APP_PREFIX = "secure_p2p_"; 
        const CHUNK_SIZE = 16384; // 16KB chunks

        let peer = null;
        let connection = null;
        let myShortCode = "";
        let selectedFile = null;
        let isPeerOpen = false;

        // DOM Elements
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

        // --- 1. PEER INITIALIZATION ---
        function initPeer() {
            const random6Digits = Math.floor(100000 + Math.random() * 900000).toString();
            myShortCode = "C" + random6Digits; 
            
            peer = new Peer(APP_PREFIX + myShortCode, {
                config: {
                    'iceServers': [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' },
                        // FREE TURN SERVERS - Critical for NAT traversal
                        {
                            urls: 'turn:openrelay.metered.ca:80',
                            username: 'openrelayproject',
                            credential: 'openrelayproject'
                        },
                        {
                            urls: 'turn:openrelay.metered.ca:443',
                            username: 'openrelayproject',
                            credential: 'openrelayproject'
                        }
                    ]
                },
                debug: 2
            });

            peer.on('open', (id) => {
                isPeerOpen = true;
                myIdEl.textContent = myShortCode;
                console.log("PeerJS Server Connected. ID:", id);
                setStatus("Sẵn sàng. Chọn file để gửi hoặc nhập mã để nhận.");
            });

            peer.on('error', (err) => {
                console.error("PeerJS Error:", err);
                if (err.type === 'unavailable-id') {
                    initPeer();
                } else if (err.type === 'peer-unavailable') {
                    setStatus("Không tìm thấy thiết bị với mã này. Kiểm tra lại mã.");
                } else {
                    setStatus("Lỗi kết nối mạng: " + err.type);
                }
            });

            // Handle incoming connections
            peer.on('connection', (conn) => {
                connection = conn;
                setupConnectionHandlers(conn, 'receiver');
            });
        }

        // --- 2. SENDER LOGIC ---
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                selectedFile = e.target.files[0];
                
                fileInfo.textContent = `${selectedFile.name} (${formatBytes(selectedFile.size)})`;
                fileInfo.classList.remove('hidden');
                
                generatedCodeEl.textContent = myShortCode;
                codeBox.classList.remove('hidden');
            }
        });

        // --- 3. RECEIVER LOGIC ---
        connectBtn.addEventListener('click', () => {
            if (!isPeerOpen) {
                setStatus("Hệ thống đang khởi động, vui lòng đợi vài giây...");
                return;
            }

            let code = receiveInput.value.trim().toUpperCase();

            if (code.length !== 7 || !code.startsWith('C') || isNaN(code.substring(1))) {
                alert("Vui lòng nhập đúng định dạng mã! (Ví dụ: C112233)");
                return;
            }

            setStatus("Đang tìm thiết bị gửi...");
            progressSection.classList.add('active');

            const conn = peer.connect(APP_PREFIX + code, {
                reliable: true,
                serialization: 'binary'
            });
            
            connection = conn;
            setupConnectionHandlers(conn, 'sender');
        });

        // --- 4. CONNECTION HANDLERS ---
        function setupConnectionHandlers(conn, role) {
            let receivedChunks = [];
            let receivedSize = 0;
            let fileMetadata = null;
            let expectedChunks = 0;

            conn.on('open', () => {
                if (role === 'sender') {
                    setStatus("Kết nối thành công! Đang chờ dữ liệu...");
                    updateProgressBar(5);
                } else {
                    // Receiver role - sender connected to us
                    if (selectedFile) {
                        setStatus("Bắt đầu truyền file...");
                        sendFileInChunks(conn, selectedFile);
                    } else {
                        setStatus("Thiết bị đã kết nối. Chọn file để gửi!");
                    }
                }
            });

            conn.on('data', (data) => {
                // Handle metadata
                if (data.type === 'metadata') {
                    fileMetadata = data;
                    expectedChunks = data.totalChunks;
                    receivedChunks = new Array(expectedChunks);
                    receivedSize = 0;
                    setStatus(`Bắt đầu nhận: ${fileMetadata.name}`);
                    progressSection.classList.add('active');
                    return;
                }

                // Handle chunk
                if (data.type === 'chunk') {
                    receivedChunks[data.index] = new Uint8Array(data.buffer);
                    receivedSize += data.buffer.byteLength;
                    
                    const percent = Math.floor((receivedSize / fileMetadata.size) * 100);
                    updateProgressBar(percent);
                    setStatus(`Đang tải... ${percent}%`);

                    // Check if complete
                    if (receivedSize >= fileMetadata.size) {
                        setStatus("Đang lắp ráp file...");
                        
                        // Combine all chunks
                        const totalLength = receivedChunks.reduce((acc, chunk) => acc + chunk.length, 0);
                        const combined = new Uint8Array(totalLength);
                        let offset = 0;
                        for (const chunk of receivedChunks) {
                            combined.set(chunk, offset);
                            offset += chunk.length;
                        }
                        
                        const blob = new Blob([combined], { type: fileMetadata.fileType });
                        
                        // Trigger download
                        const link = document.createElement('a');
                        link.href = URL.createObjectURL(blob);
                        link.download = fileMetadata.name;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        URL.revokeObjectURL(link.href);
                        
                        setStatus("Đã nhận file thành công!");
                        updateProgressBar(100);
                        
                        setTimeout(() => {
                            progressSection.classList.remove('active');
                        }, 5000);
                    }
                }
            });

            conn.on('close', () => {
                if (receivedSize === 0 || (fileMetadata && receivedSize < fileMetadata.size)) {
                    setStatus("Kết nối đã ngắt.");
                }
            });
            
            conn.on('error', (err) => {
                console.error("Connection error:", err);
                setStatus("Lỗi trong quá trình truyền dữ liệu.");
            });
        }

        // --- 5. FILE SENDING WITH CHUNKING ---
        function sendFileInChunks(conn, file) {
            const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
            let currentChunk = 0;
            
            // Send metadata first
            conn.send({
                type: 'metadata',
                name: file.name,
                size: file.size,
                fileType: file.type,
                totalChunks: totalChunks
            });

            const fileReader = new FileReader();
            
            function readNextChunk() {
                const start = currentChunk * CHUNK_SIZE;
                const end = Math.min(start + CHUNK_SIZE, file.size);
                const slice = file.slice(start, end);
                
                fileReader.readAsArrayBuffer(slice);
            }

            fileReader.onload = (e) => {
                const buffer = e.target.result;
                
                conn.send({
                    type: 'chunk',
                    index: currentChunk,
                    buffer: buffer
                });

                currentChunk++;
                const percent = Math.floor((currentChunk / totalChunks) * 100);
                updateProgressBar(percent);
                setStatus(`Đang gửi... ${percent}%`);

                if (currentChunk < totalChunks) {
                    setTimeout(readNextChunk, 5);
                } else {
                    setStatus("Đã gửi file thành công!");
                }
            };

            fileReader.onerror = () => {
                setStatus("Lỗi đọc file.");
            };

            progressSection.classList.add('active');
            readNextChunk();
        }

        // --- 6. UTILITIES ---
        function updateProgressBar(percent) {
            progressBar.style.width = percent + "%";
            statusPercent.textContent = percent + "%";
        }

        function setStatus(msg) {
            statusText.textContent = msg;
            console.log("[Status]", msg);
        }

        function formatBytes(bytes, decimals = 2) {
            if (bytes === 0) return '0 Bytes';
            const k = 1024;
            const dm = decimals < 0 ? 0 : decimals;
            const sizes = ['Bytes', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
        }

        // Start
        initPeer();