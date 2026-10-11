//* ============================================================================
// * PACS SCP Storage Server (C-ECHO + C-STORE) - DROIDSCRIPT VERSION
// *
// * THIS WORK IS NOT FIT FOR ANY FUNCTION OR PURPOSE, COMES WITH NO WARRANTY,
// * AND IS BEING RELEASED INTO THE PUBLIC DOMAIN.
// *
// * 2026-10-11 Hugo
// *
// * ============================================================================ */
// cfg.Node, cfg.Portrait, cfg.Dark

const net = require("net");
const fs = require("fs");
const path = require("path");

// ===================== Constants =====================
const DICOM_RECV_BUF_SIZE   = 1048576;
const DICOM_SEND_BUF_SIZE   = 16384;
const MAX_IMAGES_PER_FOLDER = 16000;
const MAX_PRES_CONTEXTS     = 32;

const szEchoSOPClass    = "1.2.840.10008.1.1";
const szDefaultSOPClass = "1.2.840.10008.5.1.4.1.1.7";
const szDefaultSOPInst  = "1.2.3.4.5.6.7.8.9.0";
const szImplicitVRLE    = "1.2.840.10008.1.2";
const szExplicitVRLE    = "1.2.840.10008.1.2.1";
const szAppCtxUID       = "1.2.840.10008.3.1.1.1";
const szImplClassUID    = "1.2.276.0.7230010.3.0.3.6.4";
const szImplVersionName = "PACS_SCP_TCC";

const releaseRsp = Buffer.from([0x06, 0x00, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00]);

// ===================== Globals =====================
let DATA_DIR = "/sdcard/PACS_Server";
let szIniFile = "";
let szLogFile = "";

let g_DicomPort          = 777;
let g_DebugLog           = 1;
let g_bRunning           = false;
let g_dicomServer        = null;
let g_activeSockets      = new Set();
let g_scuMaxPduLen       = 16384;

let g_CurrentFolderIndex = 0;
let g_CurrentFileIndex   = 0;

let g_aeCalled  = "PACS_SCP        ";
let g_aeCalling = "ANY-SCU         ";

// UI Elements
let txtStatus, txtLog, btnStartStop, notify, dlgSettings;
let edtAet, edtPort, chkDebug, btnDlgStartStop;
let logLines = [];

// ===================== DroidScript Entry Point =====================
function OnStart() {
    app.SetOrientation("Portrait");
    app.PreventScreenLock(true);

    // Ensure storage directory exists
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch (e) {
        DATA_DIR = app.GetPrivateFolder("pacs_data");
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    szIniFile = path.join(DATA_DIR, "pacs-server01.ini");
    szLogFile = path.join(DATA_DIR, "PACS_Server.log");

    BuildUI();

    LogText("PACS SCP Storage Server starting...");
    LoadConfig();
    LogText(`Config: AET=${g_aeCalled.trim()} DicomPort=${g_DicomPort} DebugLog=${g_DebugLog} Folder=${g_CurrentFolderIndex} File=${g_CurrentFileIndex}`);

    ServerStart();
}

// ===================== UI Construction =====================
function BuildUI() {
    let layMain = app.CreateLayout("Linear", "VCenter,FillXY");
    layMain.SetBackColor("#121212");

    // Header
    let layHeader = app.CreateLayout("Linear", "Horizontal,FillX,VCenter");
    layHeader.SetBackColor("#1565C0");
    layHeader.SetPadding(0.03, 0.015, 0.03, 0.015);

    let txtTitle = app.CreateText("PACS SCP Storage Server", 0.94, -1, "Bold,Left");
    txtTitle.SetTextSize(20);
    txtTitle.SetTextColor("#FFFFFF");
    layHeader.AddChild(txtTitle);
    layMain.AddChild(layHeader);

    // Status Banner
    txtStatus = app.CreateText("Server status: Stopped", 0.94, -1, "Multiline,Left");
    txtStatus.SetMargins(0, 0.015, 0, 0.01);
    txtStatus.SetPadding(0.03, 0.015, 0.03, 0.015);
    txtStatus.SetBackColor("#1E1E1E");
    txtStatus.SetTextColor("#90CAF9");
    txtStatus.SetTextSize(13);
    layMain.AddChild(txtStatus);

    // Control Buttons
    let layBtns = app.CreateLayout("Linear", "Horizontal,FillX,Center");
    layBtns.SetMargins(0, 0.005, 0, 0.01);

    btnStartStop = app.CreateButton("Start Server", 0.45, 0.06);
    btnStartStop.SetBackColor("#2E7D32");
    btnStartStop.SetTextColor("#FFFFFF");
    btnStartStop.SetOnTouch(function () {
        if (g_bRunning) ServerStop();
        else ServerStart();
    });
    layBtns.AddChild(btnStartStop);

    let btnSettings = app.CreateButton("Settings", 0.45, 0.06);
    btnSettings.SetMargins(0.04, 0, 0, 0);
    btnSettings.SetBackColor("#455A64");
    btnSettings.SetTextColor("#FFFFFF");
    btnSettings.SetOnTouch(ShowSettings);
    layBtns.AddChild(btnSettings);

    layMain.AddChild(layBtns);

    // Log Label + Clear Button
    let layLogHdr = app.CreateLayout("Linear", "Horizontal,FillX");
    layLogHdr.SetPadding(0.03, 0, 0.03, 0);
    let lblLog = app.CreateText("Log:", 0.7, -1, "Left,Bold");
    lblLog.SetTextColor("#B0BEC5");
    layLogHdr.AddChild(lblLog);

    let btnClear = app.CreateText("[Clear]", 0.24, -1, "Right");
    btnClear.SetTextColor("#FF8A65");
    btnClear.SetOnTouchUp(function () {
        logLines = [];
        txtLog.SetText("");
    });
    layLogHdr.AddChild(btnClear);
    layMain.AddChild(layLogHdr);

    // Log Scroller
    let scrollLog = app.CreateScroller(0.94, 0.68);
    scrollLog.SetBackColor("#0A0A0A");
    scrollLog.SetMargins(0, 0.005, 0, 0.01);

    txtLog = app.CreateText("", 0.92, -1, "Multiline,Left,Monospace");
    txtLog.SetTextColor("#00E676");
    txtLog.SetTextSize(11);
    txtLog.SetPadding(0.02, 0.01, 0.02, 0.01);
    scrollLog.AddChild(txtLog);
    layMain.AddChild(scrollLog);

    // Storage Path Footer
    let txtFooter = app.CreateText("Storage Dir: " + DATA_DIR, 0.94, -1, "Left");
    txtFooter.SetTextSize(11);
    txtFooter.SetTextColor("#757575");
    layMain.AddChild(txtFooter);

    app.AddLayout(layMain);

    // Android System Tray Ongoing Notification
    try {
        notify = app.CreateNotification("Ongoing");
    } catch (e) {}
}

function UpdateStatusUI(customStatusText) {
    let ip = app.GetIPAddress() || "127.0.0.1";
    let folderName = "SR" + String(g_CurrentFolderIndex).padStart(6, "0");
    let fileName = String(g_CurrentFileIndex).padStart(6, "0") + ".DCM";

    let baseStatus = customStatusText
        ? customStatusText
        : (g_bRunning ? `Server status: Running on port ${g_DicomPort}` : "Server status: Stopped");

    let details = `${baseStatus}\n` +
                  `IP: ${ip}  |  AET: ${g_aeCalled.trim()}  |  Last: ${folderName}\\${fileName}`;

    if (txtStatus) txtStatus.SetText(details);

    if (btnStartStop) {
        btnStartStop.SetText(g_bRunning ? "Stop Server" : "Start Server");
        btnStartStop.SetBackColor(g_bRunning ? "#C62828" : "#2E7D32");
    }

    if (btnDlgStartStop) {
        btnDlgStartStop.SetText(g_bRunning ? "Stop Server" : "Start Server");
    }

    if (notify) {
        notify.SetMessage(
            "PACS SCP Storage Server",
            baseStatus,
            `IP: ${ip} | AET: ${g_aeCalled.trim()}`
        );
        notify.Notify("pacs_tray");
    }
}

// ===================== Logging =====================
function LogText(txt) {
    let now = new Date();
    let pad = n => String(n).padStart(2, "0");
    let line = `[${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}] ${txt}`;

    if (g_DebugLog) {
        try {
            fs.appendFileSync(szLogFile, line + "\r\n");
        } catch (e) {}
    }

    logLines.push(line);
    if (logLines.length > 250) logLines.shift();
    if (txtLog) txtLog.SetText(logLines.join("\n"));
}

// ===================== INI / Config =====================
function set_ae_title(src) {
    let clean = String(src || "PACS_SCP").trim().slice(0, 16);
    g_aeCalled = clean.padEnd(16, " ");
}

function SaveConfig() {
    let content =
        `[Server]\r\n` +
        `AETitle=${g_aeCalled.trim()}\r\n` +
        `DicomPort=${g_DicomPort}\r\n` +
        `DebugLog=${g_DebugLog}\r\n` +
        `[Storage]\r\n` +
        `LastFolderIndex=${g_CurrentFolderIndex}\r\n` +
        `LastFileIndex=${g_CurrentFileIndex}\r\n`;
    try {
        fs.writeFileSync(szIniFile, content, "utf8");
    } catch (e) {
        LogText("ERROR: Failed to write INI: " + e.message);
    }
}

function LoadConfig() {
    if (!fs.existsSync(szIniFile)) {
        set_ae_title("PACS_SCP");
        g_DicomPort = 777;
        g_DebugLog = 1;
        g_CurrentFolderIndex = 0;
        g_CurrentFileIndex = 0;
        SaveConfig();
        return;
    }

    try {
        let raw = fs.readFileSync(szIniFile, "utf8");
        let map = {};
        raw.split(/\r?\n/).forEach(line => {
            let trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("[") || trimmed.startsWith(";")) return;
            let eq = trimmed.indexOf("=");
            if (eq > 0) {
                let key = trimmed.slice(0, eq).trim().toLowerCase();
                let val = trimmed.slice(eq + 1).trim();
                map[key] = val;
            }
        });

        set_ae_title(map["aetitle"] || "PACS_SCP");
        g_DicomPort = parseInt(map["dicomport"] || "777", 10);
        g_DebugLog = parseInt(map["debuglog"] || "1", 10);
        g_CurrentFolderIndex = parseInt(map["lastfolderindex"] || "0", 10);
        g_CurrentFileIndex = parseInt(map["lastfileindex"] || "0", 10);
    } catch (e) {
        LogText("ERROR: Failed to read INI: " + e.message);
    }
}

// ===================== Storage Path =====================
function GetNextStoragePath() {
    g_CurrentFileIndex++;
    if (g_CurrentFileIndex > MAX_IMAGES_PER_FOLDER) {
        g_CurrentFolderIndex++;
        g_CurrentFileIndex = 1;
    }

    SaveConfig();

    let folderName = "SR" + String(g_CurrentFolderIndex).padStart(6, "0");
    let fileName = String(g_CurrentFileIndex).padStart(6, "0") + ".DCM";
    let folderFullPath = path.join(DATA_DIR, folderName);

    try {
        if (!fs.existsSync(folderFullPath)) {
            fs.mkdirSync(folderFullPath, { recursive: true });
        }
    } catch (e) {
        LogText("ERROR creating folder " + folderName + ": " + e.message);
    }

    return {
        fullPath: path.join(folderFullPath, fileName),
        relPath: `${folderName}\\${fileName}`
    };
}

// ===================== DICOM Helpers =====================
function ReadBE32(buf, off) {
    return buf.readUInt32BE(off);
}

// Find an Implicit-VR-LE element by 4-byte little-endian tag
function FindCmdElement(cmd, tagLE) {
    let pos = 0;
    let cmdLen = cmd.length;
    while (pos + 8 <= cmdLen) {
        let t = cmd.readUInt32LE(pos);
        let l = cmd.readUInt32LE(pos + 4);
        if (t === (tagLE >>> 0)) {
            if (pos + 8 + l > cmdLen) return null;
            return cmd.slice(pos + 8, pos + 8 + l);
        }
        pos += 8 + l;
    }
    return null;
}

function ExtractCmdString(cmd, tagLE) {
    let valBuf = FindCmdElement(cmd, tagLE);
    if (!valBuf) return null;
    return valBuf.toString("ascii").replace(/[\0 ]+$/, "");
}

function ExtractCmdUS(cmd, tagLE) {
    let valBuf = FindCmdElement(cmd, tagLE);
    if (!valBuf || valBuf.length !== 2) return 0;
    return valBuf.readUInt16LE(0);
}

// Write an Implicit-VR US element (10 bytes total)
function WriteImplicitUS(grp, elem, val) {
    let b = Buffer.alloc(10);
    b.writeUInt16LE(grp & 0xFFFF, 0);
    b.writeUInt16LE(elem & 0xFFFF, 2);
    b.writeUInt32LE(2, 4);
    b.writeUInt16LE(val & 0xFFFF, 8);
    return b;
}

// Build a command set Buffer. SOP UID is padded to even length internally.
function BuildCommandSet(sopUid, cmdField, msgID, dsType, status) {
    let sopBuf = Buffer.from(sopUid, "ascii");
    let sopLen = sopBuf.length;
    let padLen = (sopLen & 1) ? sopLen + 1 : sopLen;

    // (0000,0002) Affected SOP Class UID
    let elSop = Buffer.alloc(8 + padLen, 0);
    elSop.writeUInt16LE(0x0000, 0);
    elSop.writeUInt16LE(0x0002, 2);
    elSop.writeUInt32LE(padLen, 4);
    sopBuf.copy(elSop, 8);

    let elCmdField = WriteImplicitUS(0x0000, 0x0100, cmdField);
    let elMsgID    = WriteImplicitUS(0x0000, 0x0120, msgID);
    let elDsType   = WriteImplicitUS(0x0000, 0x0800, dsType);
    let elStatus   = WriteImplicitUS(0x0000, 0x0900, status);

    let body = Buffer.concat([elSop, elCmdField, elMsgID, elDsType, elStatus]);

    // (0000,0000) Command Group Length
    let elGroupLen = Buffer.alloc(12);
    elGroupLen.writeUInt16LE(0x0000, 0);
    elGroupLen.writeUInt16LE(0x0000, 2);
    elGroupLen.writeUInt32LE(4, 4);
    elGroupLen.writeUInt32LE(body.length, 8);

    return Buffer.concat([elGroupLen, body]);
}

// Send a single P-DATA PDV
function SendPDV(sock, pcid, dataBuf, flags) {
    let dataLen = dataBuf.length;
    let pdvLen = dataLen + 2;
    let pduLen = pdvLen + 4;

    let buf = Buffer.alloc(12 + dataLen);
    buf[0] = 0x04;
    buf[1] = 0x00;
    buf.writeUInt32BE(pduLen, 2);
    buf.writeUInt32BE(pdvLen, 6);
    buf[10] = pcid & 0xFF;
    buf[11] = flags & 0xFF;
    dataBuf.copy(buf, 12);

    sock.write(buf);
}

function SendCEchoRsp(sock, pcid, msgID) {
    let cmd = BuildCommandSet(szEchoSOPClass, 0x8030, msgID, 0x0101, 0x0000);
    SendPDV(sock, pcid, cmd, 0x03);
    LogText("C-ECHO Request received. Replying with C-ECHO-RSP.");
}

function SendCStoreRsp(sock, pcid, msgID, sopClassUID) {
    let cmd = BuildCommandSet(sopClassUID, 0x8001, msgID, 0x0101, 0x0000);
    SendPDV(sock, pcid, cmd, 0x03);
    LogText("C-STORE-RSP sent.");
}

// ===================== A-ASSOCIATE-AC Builder =====================
function AppendPCAC(pcid, result, tsUid) {
    if (result !== 0) {
        return Buffer.from([0x21, 0x00, 0x00, 0x04, pcid & 0xFF, 0x00, result & 0xFF, 0x00]);
    }

    let tsBuf = Buffer.from(tsUid, "ascii");
    let tsLen = tsBuf.length;
    let padLen = (tsLen & 1) ? tsLen + 1 : tsLen;
    let itemLen = padLen + 8;

    let out = Buffer.alloc(itemLen + 4, 0);
    out[0] = 0x21; out[1] = 0x00;
    out[2] = 0x00; out[3] = itemLen & 0xFF;
    out[4] = pcid & 0xFF; out[5] = 0x00;
    out[6] = 0x00; out[7] = 0x00;

    // TS sub-item (0x40)
    out[8]  = 0x40; out[9]  = 0x00;
    out[10] = 0x00; out[11] = padLen & 0xFF;
    tsBuf.copy(out, 12);

    return out;
}

function AppendAppCtx() {
    let uidBuf = Buffer.from(szAppCtxUID, "ascii");
    let uidLen = uidBuf.length;
    let padLen = (uidLen & 1) ? uidLen + 1 : uidLen;

    let out = Buffer.alloc(padLen + 4, 0);
    out[0] = 0x10; out[1] = 0x00;
    out[2] = 0x00; out[3] = padLen & 0xFF;
    uidBuf.copy(out, 4);
    return out;
}

function AppendUserInfo() {
    let icuBuf = Buffer.from(szImplClassUID, "ascii");
    let icuLen = icuBuf.length;
    let icuPad = (icuLen & 1) ? icuLen + 1 : icuLen;

    let vnBuf  = Buffer.from(szImplVersionName, "ascii");
    let vnLen  = vnBuf.length;
    let vnPad  = (vnLen & 1) ? vnLen + 1 : vnLen;

    let total  = icuPad + vnPad + 16;
    let out    = Buffer.alloc(total + 4, 0);

    out[0] = 0x50; out[1] = 0x00;
    out[2] = 0x00; out[3] = total & 0xFF;

    let p = 4;
    // 0x51 Max PDU Length = 16384 BE
    out[p + 0] = 0x51; out[p + 1] = 0x00;
    out[p + 2] = 0x00; out[p + 3] = 0x04;
    out[p + 4] = 0x00; out[p + 5] = 0x00; out[p + 6] = 0x40; out[p + 7] = 0x00;
    p += 8;

    // 0x52 Implementation Class UID
    out[p + 0] = 0x52; out[p + 1] = 0x00;
    out[p + 2] = 0x00; out[p + 3] = icuPad & 0xFF;
    icuBuf.copy(out, p + 4);
    p += 4 + icuPad;

    // 0x55 Implementation Version Name
    out[p + 0] = 0x55; out[p + 1] = 0x00;
    out[p + 2] = 0x00; out[p + 3] = vnPad & 0xFF;
    vnBuf.copy(out, p + 4);

    return out;
}

function ParseAndBuildAC(rq, clientState) {
    let rqLen = rq.length;
    let pcCount = 0;
    clientState.pcidToTsUid.fill(null);

    // Fixed header (6 bytes PDU hdr + 4 bytes version + 16 Called AE + 16 Calling AE + 32 reserved = 74 bytes)
    let hdr = Buffer.alloc(74, 0);
    hdr[0] = 0x02; hdr[1] = 0x00;
    hdr[6] = 0x00; hdr[7] = 0x01; // Protocol version 1

    if (rqLen >= 36) {
        // Echo Called AE Title [rq+4 .. rq+20] and Calling AE Title [rq+20 .. rq+36]
        rq.copy(hdr, 10, 4, 20);
        rq.copy(hdr, 26, 20, 36);
        g_aeCalling = rq.slice(20, 36).toString("ascii");
    }

    let chunks = [hdr, AppendAppCtx()];

    // Walk RQ variable items starting at offset 68 of payload
    let pos = 68;
    while (pos + 4 <= rqLen) {
        let itemType = rq[pos];
        let itemLen  = rq.readUInt16BE(pos + 2);
        if (pos + 4 + itemLen > rqLen) break;

        if (itemType === 0x20) {
            // Presentation Context RQ
            let pcid = rq[pos + 4];
            let hasImplicit = false;
            let hasExplicit = false;
            let subPos = pos + 8;
            let accTs = null;
            let accResult = 4; // default: transfer syntaxes not supported

            while (subPos + 4 <= pos + 4 + itemLen) {
                let subType = rq[subPos];
                let subLen  = rq.readUInt16BE(subPos + 2);
                if (subType === 0x40 && subPos + 4 + subLen <= rqLen) {
                    let tsStr = rq.slice(subPos + 4, subPos + 4 + subLen).toString("ascii").replace(/\0+$/, "");
                    if (tsStr === szImplicitVRLE) hasImplicit = true;
                    else if (tsStr === szExplicitVRLE) hasExplicit = true;
                }
                subPos += 4 + subLen;
            }

            if (hasImplicit) {
                accTs = szImplicitVRLE;
                accResult = 0;
            } else if (hasExplicit) {
                accTs = szExplicitVRLE;
                accResult = 0;
            }

            if (accResult === 0 && pcid < MAX_PRES_CONTEXTS) {
                clientState.pcidToTsUid[pcid] = accTs;
            }

            chunks.push(AppendPCAC(pcid, accResult, accTs ? accTs : ""));
            pcCount++;
        } else if (itemType === 0x50) {
            // User Information — pull Max PDU length sub-item 0x51
            let subPos = pos + 4;
            while (subPos + 4 <= pos + 4 + itemLen) {
                let subType = rq[subPos];
                let subLen  = rq.readUInt16BE(subPos + 2);
                if (subType === 0x51 && subLen === 4 && subPos + 8 <= rqLen) {
                    clientState.scuMaxPduLen = rq.readUInt32BE(subPos + 4);
                    g_scuMaxPduLen = clientState.scuMaxPduLen;
                }
                subPos += 4 + subLen;
            }
        }

        pos += 4 + itemLen;
    }

    chunks.push(AppendUserInfo());

    let outBuf = Buffer.concat(chunks);
    let pduLen = outBuf.length - 6;
    outBuf.writeUInt32BE(pduLen, 2);

    return { acBuf: outBuf, pcCount: pcCount };
}

function DICOM_SendAssociateAC(sock, rq, clientState) {
    let { acBuf, pcCount } = ParseAndBuildAC(rq, clientState);
    sock.write(acBuf);
    LogText(`A-ASSOCIATE-AC sent on socket ${clientState.id} (PDU len ${acBuf.length}, ${pcCount} PCs)`);
}

// ===================== DICOM P-DATA-TF Processor =====================
function CloseStorageFile(clientState) {
    if (clientState.fd !== null) {
        try {
            fs.closeSync(clientState.fd);
        } catch (e) {}
        clientState.fd = null;
    }
}

function ProcessPDataPDU(sock, payload, clientState) {
    let pduLen = payload.length;
    let pos = 0;

    while (pos + 6 <= pduLen) {
        let pdvLen = ReadBE32(payload, pos);
        if (pdvLen < 2 || pos + pdvLen + 4 > pduLen) break;

        let pcid    = payload[pos + 4];
        let flags   = payload[pos + 5];
        let fragLen = pdvLen - 2;
        let frag    = payload.slice(pos + 6, pos + 6 + fragLen);

        if (flags & 1) {
            // Command PDV
            let cmdField = ExtractCmdUS(frag, 0x01000000);
            let msgID    = ExtractCmdUS(frag, 0x01100000);
            if (msgID === 0) msgID = 1;

            if (cmdField === 0x0030) {
                SendCEchoRsp(sock, pcid, msgID);
            } else if (cmdField === 0x0001) {
                let sopClass = ExtractCmdString(frag, 0x00020000);
                let sopInst  = ExtractCmdString(frag, 0x10000000);
                if (sopClass) clientState.currentSOPClass = sopClass;
                if (sopInst)  clientState.currentSOPInst  = sopInst;

                LogText(`C-STORE-RQ received. SOP Class=${clientState.currentSOPClass}`);
                clientState.pendingMsgID = msgID;
                clientState.pendingPCID  = pcid;
            }
        } else {
            // Data PDV
            if (!clientState.bReceivingImage) {
                let pathInfo = GetNextStoragePath();
                clientState.tmpFullPath = pathInfo.fullPath;
                clientState.tmpRelPath  = pathInfo.relPath;
                try {
                    clientState.fd = fs.openSync(clientState.tmpFullPath, "w");
                    clientState.bReceivingImage = true;
                } catch (e) {
                    LogText("ERROR opening file: " + e.message);
                    clientState.fd = null;
                    pos += pdvLen + 4;
                    continue;
                }
            }

            if (clientState.fd !== null) {
                try {
                    fs.writeSync(clientState.fd, frag);
                } catch (e) {
                    LogText("ERROR writing file bytes: " + e.message);
                }
            }

            if (flags & 2) {
                CloseStorageFile(clientState);
                LogText(`Image saved to: ${clientState.tmpRelPath}`);
                clientState.bReceivingImage = false;
                SendCStoreRsp(sock, clientState.pendingPCID, clientState.pendingMsgID, clientState.currentSOPClass);
                UpdateStatusUI();
            }
        }

        pos += pdvLen + 4;
    }
}

// ===================== Socket Server Lifecycle =====================
let g_nextSocketId = 100;

function StartDicomServer() {
    g_dicomServer = net.createServer(sock => {
        let sockId = g_nextSocketId++;
        g_activeSockets.add(sock);

        let clientState = {
            id: sockId,
            bReceivingImage: false,
            pendingMsgID: 1,
            pendingPCID: 1,
            fd: null,
            tmpFullPath: "",
            tmpRelPath: "",
            scuMaxPduLen: 16384,
            currentSOPClass: szDefaultSOPClass,
            currentSOPInst: szDefaultSOPInst,
            pcidToTsUid: new Array(MAX_PRES_CONTEXTS).fill(null)
        };

        LogText(`DICOM client connected (socket ${sockId})`);

        let rxBuf = Buffer.alloc(0);

        sock.on("data", chunk => {
            rxBuf = Buffer.concat([rxBuf, chunk]);

            while (rxBuf.length >= 6) {
                let pduType = rxBuf[0];
                let pduLen  = ReadBE32(rxBuf, 2);

                if (pduLen > DICOM_RECV_BUF_SIZE - 6) {
                    sock.destroy();
                    return;
                }
                if (rxBuf.length < 6 + pduLen) break;

                let payload = rxBuf.slice(6, 6 + pduLen);
                rxBuf = rxBuf.slice(6 + pduLen);

                if (pduType === 0x01) {
                    DICOM_SendAssociateAC(sock, payload, clientState);
                } else if (pduType === 0x04) {
                    ProcessPDataPDU(sock, payload, clientState);
                } else if (pduType === 0x05) {
                    sock.write(releaseRsp);
                    sock.end();
                    break;
                }
            }
        });

        sock.on("close", () => {
            CloseStorageFile(clientState);
            g_activeSockets.delete(sock);
            LogText(`DICOM client disconnected (socket ${sockId})`);
        });

        sock.on("error", () => {
            CloseStorageFile(clientState);
            g_activeSockets.delete(sock);
        });
    });

    g_dicomServer.on("error", err => {
        if (err.code === "EACCES" && g_DicomPort < 1024) {
            LogText(`Port ${g_DicomPort} requires root on Android. Falling back to 1777.`);
            g_DicomPort = 1777;
            g_dicomServer.listen(g_DicomPort, "0.0.0.0");
        } else {
            LogText(`ERROR: Failed to listen on DICOM port ${g_DicomPort}`);
            g_bRunning = false;
            UpdateStatusUI(`Server status: Failed to bind port ${g_DicomPort}`);
        }
    });

    g_dicomServer.listen(g_DicomPort, "0.0.0.0", () => {
        g_bRunning = true;
        LogText(`DICOM SCP listening on port ${g_DicomPort}`);
        LogText("Server STARTED");
        UpdateStatusUI(`Server status: Running on port ${g_DicomPort}`);
    });
}

function ServerStart() {
    if (g_bRunning) return;
    StartDicomServer();
}

function ServerStop() {
    if (!g_bRunning) return;
    for (let s of g_activeSockets) {
        try { s.destroy(); } catch (e) {}
    }
    g_activeSockets.clear();

    if (g_dicomServer) {
        g_dicomServer.close();
        g_dicomServer = null;
    }

    g_bRunning = false;
    LogText("Server STOPPED");
    UpdateStatusUI("Server status: Stopped");
}

// ===================== Settings Dialog (Port of SettingsProc) =====================
function ShowSettings() {
    dlgSettings = app.CreateDialog("Settings");
    let layDlg = app.CreateLayout("Linear", "VCenter,FillXY");
    layDlg.SetPadding(0.04, 0.02, 0.04, 0.02);
    layDlg.SetBackColor("#263238");

    // Row 1: Server AET
    let rowAet = app.CreateLayout("Linear", "Horizontal,FillX,VCenter");
    let lblAet = app.CreateText("Server AET:", 0.38, -1, "Left");
    lblAet.SetTextColor("#ECEFF1");
    rowAet.AddChild(lblAet);
    edtAet = app.CreateTextEdit(g_aeCalled.trim(), 0.48, -1, "SingleLine");
    edtAet.SetTextColor("#FFFFFF");
    rowAet.AddChild(edtAet);
    layDlg.AddChild(rowAet);

    // Row 2: DICOM Port
    let rowPort = app.CreateLayout("Linear", "Horizontal,FillX,VCenter");
    let lblPort = app.CreateText("DICOM Port:", 0.38, -1, "Left");
    lblPort.SetTextColor("#ECEFF1");
    rowPort.AddChild(lblPort);
    edtPort = app.CreateTextEdit(String(g_DicomPort), 0.48, -1, "Numbers,SingleLine");
    edtPort.SetTextColor("#FFFFFF");
    rowPort.AddChild(edtPort);
    layDlg.AddChild(rowPort);

    // Row 3: Debug Logging Checkbox
    chkDebug = app.CreateCheckBox("Debug Logging: Enabled", 0.86, -1);
    chkDebug.SetMargins(0, 0.015, 0, 0.015);
    chkDebug.SetTextColor("#ECEFF1");
    chkDebug.SetChecked(g_DebugLog === 1);
    layDlg.AddChild(chkDebug);

    // Action Buttons: Start/Stop, Save Settings, Close
    let layAct = app.CreateLayout("Linear", "Horizontal,Center");
    layAct.SetMargins(0, 0.02, 0, 0.01);

    btnDlgStartStop = app.CreateButton(g_bRunning ? "Stop Server" : "Start Server", 0.28, 0.06);
    btnDlgStartStop.SetBackColor("#37474F");
    btnDlgStartStop.SetTextColor("#FFFFFF");
    btnDlgStartStop.SetOnTouch(function () {
        if (g_bRunning) ServerStop();
        else ServerStart();
    });
    layAct.AddChild(btnDlgStartStop);

    let btnSave = app.CreateButton("Save Settings", 0.30, 0.06);
    btnSave.SetMargins(0.02, 0, 0.02, 0);
    btnSave.SetBackColor("#1565C0");
    btnSave.SetTextColor("#FFFFFF");
    btnSave.SetOnTouch(function () {
        set_ae_title(edtAet.GetText());
        let newPort = parseInt(edtPort.GetText(), 10);
        if (!isNaN(newPort) && newPort > 0) g_DicomPort = newPort;
        g_DebugLog = chkDebug.GetChecked() ? 1 : 0;

        SaveConfig();
        UpdateStatusUI();
        app.ShowPopup("Settings Saved");
    });
    layAct.AddChild(btnSave);

    let btnClose = app.CreateButton("Close", 0.24, 0.06);
    btnClose.SetBackColor("#546E7A");
    btnClose.SetTextColor("#FFFFFF");
    btnClose.SetOnTouch(function () {
        dlgSettings.Dismiss();
    });
    layAct.AddChild(btnClose);

    layDlg.AddChild(layAct);
    dlgSettings.AddLayout(layDlg);
    dlgSettings.Show();
}