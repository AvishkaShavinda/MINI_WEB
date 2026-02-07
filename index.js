const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    Browsers, 
    delay, 
    DisconnectReason 
} = require('baileys');
const pino = require('pino');
const express = require('express');
const { Boom } = require('@hapi/boom');
const fs = require('fs-extra');

const app = express();
const PORT = process.env.PORT || 3000;

// --- 1. WEB INTERFACE (HTML/CSS/JS) ---
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="si">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AVI MINI - MULTI DEVICE SESSION</title>
    <style>
        body { font-family: 'Poppins', sans-serif; background: #050c16; color: white; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
        .box { background: #0f172a; padding: 40px; border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); text-align: center; border: 1px solid #1e293b; width: 90%; max-width: 400px; }
        h1 { color: #38bdf8; margin-bottom: 10px; font-size: 24px; }
        p { color: #94a3b8; font-size: 14px; }
        input { width: 100%; padding: 12px; margin: 20px 0; border-radius: 10px; border: 1px solid #334155; background: #1e293b; color: white; text-align: center; font-size: 16px; box-sizing: border-box; }
        button { background: #38bdf8; color: #0f172a; border: none; padding: 12px 30px; border-radius: 10px; cursor: pointer; font-weight: bold; width: 100%; font-size: 16px; transition: 0.3s; }
        button:hover { background: #0ea5e9; transform: translateY(-2px); }
        #pairCode { margin-top: 25px; font-size: 28px; font-weight: bold; color: #fbbf24; background: #1e293b; padding: 15px; border-radius: 10px; display: none; letter-spacing: 5px; border: 2px dashed #fbbf24; }
        .loader { display: none; margin-top: 15px; color: #38bdf8; font-size: 14px; }
    </style>
</head>
<body>
    <div class="box">
        <h1>AVI MINI SESSION </h1>
        <p>නම්බර් එක ඇතුළත් කර Pair Code එක ලබාගන්න</p>
        <input type="text" id="number" placeholder="947xxxxxxxx" />
        <button id="btn" onclick="getPairCode()">GET PAIR CODE</button>
        <div class="loader" id="loading">කේතය සාදමින් පවතී... කරුණාකර රැඳී සිටින්න ⏳</div>
        <div id="pairCode"></div>
    </div>

    <script>
        async function getPairCode() {
            const num = document.getElementById('number').value;
            const btn = document.getElementById('btn');
            const codeDiv = document.getElementById('pairCode');
            const loader = document.getElementById('loading');

            if (!num || num.length < 10) return alert('නිවැරදි දුරකථන අංකයක් ඇතුළත් කරන්න!');

            btn.style.display = 'none';
            loader.style.display = 'block';
            codeDiv.style.display = 'none';

            try {
                const res = await fetch('/get-pair-code?number=' + num);
                const data = await res.json();
                loader.style.display = 'none';
                btn.style.display = 'block';

                if (data.code) {
                    codeDiv.innerText = data.code;
                    codeDiv.style.display = 'block';
                } else {
                    alert('දෝෂයක් සිදු විය! නැවත උත්සාහ කරන්න.');
                }
            } catch (e) {
                alert('Server Error!');
                loader.style.display = 'none';
                btn.style.display = 'block';
            }
        }
    </script>
</body>
</html>
    `);
});

// --- 2. BOT LOGIC & MULTI-SESSION ---

async function startAviMini(num, res = null) {
    const sessionPath = `./sessions/${num}`;
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    
    const Avi = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: Browsers.ubuntu('Chrome')
    });

    // Pair code request logic
    if (res && !Avi.authState.creds.registered) {
        try {
            await delay(3000);
            const code = await Avi.requestPairingCode(num);
            if (!res.headersSent) {
                res.json({ code: code?.match(/.{1,4}/g)?.join('-') || code });
            }
        } catch (e) {
            if (!res.headersSent) res.status(500).json({ error: "Fail" });
        }
    }

    Avi.ev.on('creds.update', saveCreds);

    Avi.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            console.log(`[CONNECTED] ${num} active now! ✅`);
            await Avi.sendMessage(Avi.user.id, { text: `*AVI MINI CONNECTED SUCCESSFULLY!* 👊😈\n\nSession active for: ${num}` });
        }
        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output.statusCode;
            if (reason !== DisconnectReason.loggedOut) {
                startAviMini(num);
            } else {
                console.log(`[LOGGED OUT] ${num} session deleted.`);
                fs.removeSync(sessionPath);
            }
        }
    });

    // Simple Command Handler
    Avi.ev.on('messages.upsert', async (chat) => {
        const m = chat.messages[0];
        //if (!m.message || m.key.fromMe) return;
        const from = m.key.remoteJid;
        const body = m.message.conversation || m.message.extendedTextMessage?.text || "";
        
        if (body.toLowerCase() === '.alive') {
            await Avi.sendMessage(from, { text: 'I am Alive! 🚀' });
        }
    });
}

// Pair code endpoint
app.get('/get-pair-code', async (req, res) => {
    const num = req.query.number?.replace(/[^0-9]/g, '');
    if (!num) return res.json({ error: "Invalid number" });
    startAviMini(num, res);
});

// Restart existing sessions on server boot
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    if (fs.existsSync('./sessions')) {
        const folders = fs.readdirSync('./sessions');
        folders.forEach(file => {
            if (fs.lstatSync(`./sessions/${file}`).isDirectory()) {
                startAviMini(file);
            }
        });
    }
});
