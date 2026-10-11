//* ============================================================================
// * RIS Multi-Protocol Server (DICOM + Telnet + HTTP) - DROIDSCRIPT VERSION
// *
// * THIS WORK IS NOT FIT FOR ANY FUNCTION OR PURPOSE, COMES WITH NO WARRANTY,
// * AND IS BEING RELEASED INTO THE PUBLIC DOMAIN.
// *
// *2026-10-11 Hugo
// *
// * ============================================================================ */
// cfg.Node, cfg.Portrait, cfg.Dark

const net = require("net");
const fs = require("fs");
const path = require("path");

// ===== Constants & Configuration =====
const FIELD_COUNT = 27;
const DEFAULT_TIMEOUT_MS = 10000;
const MAX_CSV_ROWS = 16384;
const MAX_PROC_CODES = 256;

const szCSVHeader = "PatientName,PatientID,BirthDate,Sex,ReqPhys,ReqSvc,ProcDesc,Reason,Accession,ProcID,Priority,StationAE,StartDate,StartTime,PerfPhys,SPSDesc,SPSID,StationName,Location,Status,Modality,RefPhys,StudyDesc,ProtoCode,ProtoScheme,ProtoMeaning,StudyUID";

let DATA_DIR = "/sdcard/RIS_Server";
let szIniFile = "";

let g_TelnetPort = 2323; // Unprivileged default for Android (23 in C)
let g_HttpPort = 8080;   // Unprivileged default for Android (80 in C)
let g_DicomPort = 1104;  // Unprivileged default for Android (104 in C)
let g_TelnetTimeout = 10;
let g_DebugLog = 1;
let g_bRunning = false;
let g_aeCalled = "AUTOIT_SCP";
let g_delPwd = "0";
let g_omittedFields = "0";

// Servers & Clients
let g_serverTelnet = null;
let g_serverHttp = null;
let g_serverDicom = null;
let g_telnetClients = new Set();

// In-Memory CSV Store
let g_csvData = [];
let g_csvInitialized = false;

// Procedure Codes Store
let g_procCodes = [];
let g_procCodesLoaded = false;

// Patient Directory Store (patients.csv)
let patients_csv_data = null;
let pts_name_col_idx = -1;
let pts_id_col_idx = 0;
let pts_birthdate_col_idx = -1;
let pts_sex_col_idx = -1;

// DroidScript UI References
let txtLog, txtStatus, btnStartStop, notify, dlgSettings, dlgWeb;
let edtAet, edtTelnet, edtHttp, edtDicom, edtTimeout, edtPwd, edtOmitted, chkDebug;
let logLines = [];

// ===== HTML Templates =====
const szHtmlStart = `<html><head><title>RIS Worklist Manager</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>
table{border-collapse:collapse;width:100%;font-size:14px;}th,td{border:1px solid #dddddd;padding:12px;}th{background:#009879;color:#fff;text-align:left;}
tr{border-bottom:1px solid #ddd;}tr:nth-child(even){background:#f3f3f3;}input,select{margin:5px;padding:5px;}div.query-box{margin:20px;padding:10px;background:#f9f9f9;border-radius:5px;}div.form-row{display:inline-block;margin-right:15px;}
.top-btn { min-width: 140px; height: 36px; padding: 0 15px; box-sizing: border-box; text-align: center; border: none; cursor: pointer; color: white; display: inline-block; font-size: 14px; margin: 0; line-height: 36px; border-radius: 4px; text-decoration: none; }
.bg-green { background: #4CAF50; } .bg-blue { background: #2196F3; } .bg-red { background: #f44336; }
</style>
<script>var fnames=['PatientName','PatientID','BirthDate','Sex','ReqPhys','ReqSvc','ProcDesc','Reason','Accession','ProcID','Priority','StationAE','StartDate','StartTime','PerfPhys','SPSDesc','SPSID','StationName','Location','Status','Modality','RefPhys','StudyDesc','ProtoCode','ProtoScheme','ProtoMeaning','StudyUID'];
function f(r){var c=r.cells;for(var i=0;i<c.length&&i<fnames.length;i++){var e=document.getElementsByName(fnames[i])[0];if(e)e.value=(c[i].innerText||c[i].textContent).trim();}
var sel=document.getElementById('procCodeSel');if(sel){var pid=document.getElementsByName('ProcID')[0].value;for(var j=0;j<sel.options.length;j++){sel.options[j].selected=(sel.options[j].getAttribute('data-id')===pid);}}}
window.maxAcc=window.maxAcc||0;
function nxtA(){var t=document.getElementById('pTable'),m=0,p='ACC',c=5;if(t){for(var i=1;i<t.rows.length;i++){var v=t.rows[i].cells[8].innerText||'',mt=v.match(/([^0-9]*)([0-9]+)/);if(mt){p=mt[1];var val=parseInt(mt[2],10);if(val>m){m=val;c=mt[2].length;}}}}if(window.maxAcc<=m)window.maxAcc=m;window.maxAcc++;document.getElementsByName('Accession')[0].value=p+String(window.maxAcc).padStart(c,'0');}
function sendMan(){var a=document.getElementsByName('Accession')[0].value.trim();if(!a){alert('Accession number is required!');return false;}
var sel=document.getElementById('procCodeSel');var opts=[];if(sel){for(var j=0;j<sel.options.length;j++){if(sel.options[j].selected&&sel.options[j].value!=='')opts.push(sel.options[j]);}}
if(opts.length>1){var p=[];for(var k=0;k<opts.length;k++){nxtA();
document.getElementsByName('Modality')[0].value=opts[k].getAttribute('data-mod')||'';
document.getElementsByName('ProcDesc')[0].value=opts[k].text||'';
document.getElementsByName('ProcID')[0].value=opts[k].getAttribute('data-id')||'';
document.getElementsByName('SPSID')[0].value=opts[k].getAttribute('data-code')||'';
document.getElementsByName('StationAE')[0].value='';
document.getElementsByName('SPSDesc')[0].value='';
var sn=document.getElementsByName('StationName')[0];if(sn)sn.value='';
document.getElementsByName('Location')[0].value='';
document.getElementsByName('StudyDesc')[0].value='';
var c=[];for(var i=0;i<fnames.length;i++){var el=document.getElementsByName(fnames[i])[0];var v=el?el.value:'';if(v.indexOf(',')>-1||v.indexOf('"')>-1)v='"'+v.replace(new RegExp('"','g'),'""')+'"';c.push(v);}
p.push(fetch('/manual',{method:'POST',body:c.join(',')}));}Promise.all(p).then(function(){window.location.href='/';});return false;}
var c=[];for(var i=0;i<fnames.length;i++){var el=document.getElementsByName(fnames[i])[0];var v=el?el.value:'';if(v.indexOf(',')>-1||v.indexOf('"')>-1)v='"'+v.replace(new RegExp('"','g'),'""')+'"';c.push(v);}fetch('/manual',{method:'POST',body:c.join(',')}).then(function(){window.location.href='/';});return false;}
function delP(){var a=document.getElementsByName('Accession')[0].value;if(a&&confirm('Delete Patient '+a+'?'))fetch('/delpat',{method:'POST',body:a}).then(function(){window.location.href='/';});}
function delAll(){var p=prompt('Enter password to delete all data:');if(p!==null){document.getElementById('delPwd').value=p;document.getElementById('delAllForm').submit();}}
function multiStudy(){alert('Stub not implemented');}
function sortTable(n){var t,r,sw,i,x,y,sd,d;t=document.getElementById('pTable');sw=true;d='asc';while(sw){sw=false;r=t.rows;for(i=1;i<(r.length-1);i++){sd=false;x=r[i].getElementsByTagName('TD')[n];y=r[i+1].getElementsByTagName('TD')[n];if(d=='asc'){if(x.innerHTML.toLowerCase()>y.innerHTML.toLowerCase()){sd=true;break;}}else{if(x.innerHTML.toLowerCase()<y.innerHTML.toLowerCase()){sd=true;break;}}}if(sd){r[i].parentNode.insertBefore(r[i+1],r[i]);sw=true;}}}
function formatDates(){var t=document.getElementById('pTable');if(!t)return;for(var i=1;i<t.rows.length;i++){var c=t.rows[i].cells;if(c.length>13){
var b=c[2].innerText;if(b.length===8)c[2].innerText=b.substr(0,4)+'-'+b.substr(4,2)+'-'+b.substr(6,2);
var s=c[12].innerText;if(s.length===8)c[12].innerText=s.substr(0,4)+'-'+s.substr(4,2)+'-'+s.substr(6,2);
var tm=c[13].innerText;if(tm.length===6)c[13].innerText=tm.substr(0,2)+':'+tm.substr(2,2);
}}}
function newPatient(){for(var i=0;i<fnames.length;i++){var el=document.getElementsByName(fnames[i])[0];if(el)el.value='';}var d=new Date(),y=d.getFullYear(),mo=('0'+(d.getMonth()+1)).slice(-2),da=('0'+d.getDate()).slice(-2);var sd=document.getElementsByName('StartDate')[0];if(sd)sd.value=y+'-'+mo+'-'+da;nxtA();var su=document.getElementsByName('StudyUID')[0];if(su){var sec=Math.floor(Date.now()/1000);var rnd=Math.floor(Math.random()*10000);su.value='1.2.840.113619.2.1.'+sec+'.'+rnd;}var stat=document.getElementsByName('Status')[0];if(stat)stat.value='1';var pri=document.getElementsByName('Priority')[0];if(pri)pri.value='LOW';var tm=document.getElementsByName('StartTime')[0];if(tm)tm.value='16:00';}
function loadProcCode(){var sel=document.getElementById('procCodeSel');if(sel&&sel.selectedIndex>=0){var idx=sel.selectedIndex;
var id=document.getElementsByName('ProcID')[0];var code=document.getElementsByName('SPSID')[0];var mod=document.getElementsByName('Modality')[0];var desc=document.getElementsByName('ProcDesc')[0];
if(id&&code&&mod&&desc){id.value=sel.options[idx].getAttribute('data-id')||'';code.value=sel.options[idx].getAttribute('data-code')||'';mod.value=sel.options[idx].getAttribute('data-mod')||'';desc.value=sel.options[idx].text;}}
}
function filterProcCodes(){var i,f=document.getElementById('procFilter').value.toUpperCase(),s=document.getElementById('procCodeSel'),o=s.options;for(i=0;i<o.length;i++){if((o[i].text||o[i].innerText).toUpperCase().indexOf(f)>-1){o[i].style.display='';}else{o[i].style.display='none';o[i].selected=false;}}}
let ptDebounce=null;let ptAbort=null;
function filterPatients(){
    var f=document.getElementById('patientFilter').value.trim();
    if(ptDebounce)clearTimeout(ptDebounce);
    ptDebounce=setTimeout(async function(){
        if(ptAbort)ptAbort.abort();
        ptAbort=new AbortController();
        try{
            var res=await fetch('/api/patients?filter='+encodeURIComponent(f),{signal:ptAbort.signal});
            if(!res.ok)return;
            var names=await res.json();
            var sel=document.getElementById('patientSel');
            sel.options.length=0;
            names.forEach(function(n){
                var opt=document.createElement('option');
                opt.value=n;opt.text=n;
                sel.appendChild(opt);
            });
        }catch(e){}
    },250);
}
async function loadPatientDetails(name){if(!name)return;try{var res=await fetch('/api/patient/'+encodeURIComponent(name));if(!res.ok)return;var data=await res.json();if(!data.error){document.getElementsByName('PatientName')[0].value=data.name||'';document.getElementsByName('PatientID')[0].value=data.patient_id||'';
var bd=data.birthdate||'';if(/^\\d{8}$/.test(bd)){bd=bd.substr(0,4)+'-'+bd.substr(4,2)+'-'+bd.substr(6,2);}else if(bd.indexOf('/')>-1){var p=bd.split('/');if(p.length===3){if(p[2].length===4)bd=p[2]+'-'+p[0].padStart(2,'0')+'-'+p[1].padStart(2,'0');else if(p[0].length===4)bd=p[0]+'-'+p[1].padStart(2,'0')+'-'+p[2].padStart(2,'0');}}
document.getElementsByName('BirthDate')[0].value=bd;document.getElementsByName('Sex')[0].value=data.sex||'';}}catch(e){}}
function filterStatus(s){var t=document.getElementById('pTable');if(!t)return;for(var i=1;i<t.rows.length;i++){var st=t.rows[i].cells[19].innerText||t.rows[i].cells[19].textContent;if(s===''||st.trim()===s)t.rows[i].style.display='';else t.rows[i].style.display='none';}}
window.onload=function(){newPatient();filterPatients();filterStatus('1');};</script></head><body style='font-family:Arial,sans-serif;padding:20px;'>`;

const szHtmlFormsTop = `<div class='form-row' style='display:flex; flex-wrap:wrap; align-items:center; gap:10px; margin-top:20px; margin-bottom:15px;'>
<button type='button' onclick='newPatient()' class='top-btn bg-green'>New Patient</button>
<button type='button' onclick=' filterPatients()' class='top-btn bg-blue'>Search</button>
<form action='/upload' method='POST' enctype='multipart/form-data' id='uploadForm' style='display:inline-flex; align-items:center; gap:10px; margin:0;'>
<input type='file' name='csvfile' id='csvfile' style='display:none;' onchange='document.getElementById("uploadForm").submit();'>
<label for='csvfile' class='top-btn bg-blue'>Choose File</label>
</form>
<form action='/delete' method='POST' id='delAllForm' style='margin:0;'>
<input type='hidden' name='pwd' id='delPwd' value=''>
<input type='button' value='Delete All Data' class='top-btn bg-red' onclick='delAll()'>
</form></div><hr>
<form id='manForm'>`;

const szHtmlFormsInputs = `<input type='text' name='PatientName' placeholder='Patient Name'> <input type='text' name='PatientID' placeholder='Patient ID'> Birth: <input type='date' name='BirthDate'> <select name='Sex'><option value=''>Sex</option><option value='M'>M</option><option value='F'>F</option><option value='O'>O</option></select><br>
<input type='text' name='ReqPhys' placeholder='Req Phys'> <input type='text' name='ReqSvc' placeholder='Req Svc'> <input type='text' name='ProcDesc' placeholder='Proc Desc'> <input type='text' name='Reason' placeholder='Reason'><br>
<input type='text' name='Accession' placeholder='Accession'> <input type='text' name='ProcID' placeholder='Proc ID'> <select name='Priority'><option value='LOW' selected>LOW</option><option value='MEDIUM'>MEDIUM</option><option value='ROUTINE'>ROUTINE</option><option value='HIGH'>HIGH</option></select> <input type='text' name='StationAE' placeholder='Station AE'><br>
Start: <input type='date' name='StartDate'> Time: <input type='time' name='StartTime'> <input type='text' name='PerfPhys' placeholder='Perf Phys'> <input type='text' name='SPSDesc' placeholder='SPS Desc'><br>
<input type='text' name='SPSID' placeholder='SPS ID'> `;

const szHtmlForms2 = ` <select name='Status'><option value='0'>NONE</option><option value='1' selected>SCHEDULED</option><option value='2'>ARRIVED</option><option value='3'>READY</option><option value='4'>STARTED</option><option value='5'>DEPARTED</option></select><br>
<input type='text' name='Modality' placeholder='Modality'> <input type='text' name='RefPhys' placeholder='Ref Phys'> <input type='text' name='StudyDesc' placeholder='Study Desc'><br>
<input type='text' name='ProtoCode' placeholder='Proto Code'> <input type='text' name='ProtoScheme' placeholder='Proto Scheme'> <input type='text' name='ProtoMeaning' placeholder='Proto Meaning'><br>
<input type='text' name='StudyUID' placeholder='Study UID' style='width:300px;'><br>
<div style='margin-top:15px; display:flex; flex-wrap:wrap; gap:10px;'>
<button type='button' onclick='sendMan()' class='top-btn bg-green'>Add/Edit Patient</button> 
<button type='button' onclick='nxtA()' class='top-btn bg-blue'>Next Accession</button> 
<button type='button' onclick='multiStudy()' class='top-btn bg-blue'>Stub</button> 
<button type='button' onclick='delP()' class='top-btn bg-red'>Delete Patient</button></div></form><hr>`;

const szHtmlEnd = `</body></html>`;

// ===== DroidScript Entry Point =====
function OnStart() {
    app.SetOrientation("Portrait");
    app.PreventScreenLock(true);

    // Prepare data directory
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch (e) {
        DATA_DIR = app.GetPrivateFolder("ris_data");
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    szIniFile = path.join(DATA_DIR, "RIS_SERVER.ini");

    BuildUI();
    write_log("RIS Server starting...");
    LoadConfig();
    write_log(`Config: AET=${g_aeCalled.trim()} TelnetPort=${g_TelnetPort} HttpPort=${g_HttpPort} DicomPort=${g_DicomPort} Timeout=${g_TelnetTimeout} DebugLog=${g_DebugLog}`);

    EnsureCsvInitialized();
    g_csvData = [szCSVHeader]; // Reset to header only on startup (matching main() in C)
    LoadProcedureCodes();

    ServerStart();
}

// ===== UI Construction =====
function BuildUI() {
    let layMain = app.CreateLayout("Linear", "VCenter,FillXY");
    layMain.SetBackColor("#121212");

    // Header Bar
    let layHeader = app.CreateLayout("Linear", "Horizontal,FillX,VCenter");
    layHeader.SetBackColor("#009879");
    layHeader.SetPadding(0.03, 0.015, 0.03, 0.015);

    let txtTitle = app.CreateText("RIS Multi-Protocol Server", 0.94, -1, "Bold,Left");
    txtTitle.SetTextSize(20);
    txtTitle.SetTextColor("#FFFFFF");
    layHeader.AddChild(txtTitle);
    layMain.AddChild(layHeader);

    // Status Card
    txtStatus = app.CreateText("Initializing...", 0.94, -1, "Multiline,Left");
    txtStatus.SetMargins(0, 0.015, 0, 0.01);
    txtStatus.SetPadding(0.03, 0.015, 0.03, 0.015);
    txtStatus.SetBackColor("#1E1E1E");
    txtStatus.SetTextColor("#80CBC4");
    txtStatus.SetTextSize(13);
    layMain.AddChild(txtStatus);

    // Top Action Buttons
    let layBtns = app.CreateLayout("Linear", "Horizontal,FillX,Center");
    layBtns.SetMargins(0, 0.005, 0, 0.01);

    btnStartStop = app.CreateButton("Stop Server", 0.31, 0.06);
    btnStartStop.SetBackColor("#2E7D32");
    btnStartStop.SetTextColor("#FFFFFF");
    btnStartStop.SetOnTouch(ToggleServer);
    layBtns.AddChild(btnStartStop);

    let btnWeb = app.CreateButton("Web Manager", 0.31, 0.06);
    btnWeb.SetMargins(0.015, 0, 0.015, 0);
    btnWeb.SetBackColor("#1976D2");
    btnWeb.SetTextColor("#FFFFFF");
    btnWeb.SetOnTouch(ShowWebManager);
    layBtns.AddChild(btnWeb);

    let btnSettings = app.CreateButton("Settings", 0.31, 0.06);
    btnSettings.SetBackColor("#455A64");
    btnSettings.SetTextColor("#FFFFFF");
    btnSettings.SetOnTouch(ShowSettingsDialog);
    layBtns.AddChild(btnSettings);

    layMain.AddChild(layBtns);

    // Console Output Header
    let layLogHdr = app.CreateLayout("Linear", "Horizontal,FillX");
    layLogHdr.SetPadding(0.03, 0, 0.03, 0);
    let lblConsole = app.CreateText("Server Console Log:", 0.7, -1, "Left,Bold");
    lblConsole.SetTextColor("#B0BEC5");
    layLogHdr.AddChild(lblConsole);

    let btnClearLog = app.CreateText("[Clear]", 0.24, -1, "Right");
    btnClearLog.SetTextColor("#FF8A65");
    btnClearLog.SetOnTouchUp(function () {
        logLines = [];
        txtLog.SetText("");
    });
    layLogHdr.AddChild(btnClearLog);
    layMain.AddChild(layLogHdr);

    // Console Log Scroller
    let scrollLog = app.CreateScroller(0.94, 0.68);
    scrollLog.SetBackColor("#0A0A0A");
    scrollLog.SetMargins(0, 0.005, 0, 0.01);

    txtLog = app.CreateText("", 0.92, -1, "Multiline,Left,Monospace");
    txtLog.SetTextColor("#00E676");
    txtLog.SetTextSize(11);
    txtLog.SetPadding(0.02, 0.01, 0.02, 0.01);
    scrollLog.AddChild(txtLog);
    layMain.AddChild(scrollLog);

    // Footer info
    let txtFooter = app.CreateText("Data Folder: " + DATA_DIR, 0.94, -1, "Left");
    txtFooter.SetTextSize(11);
    txtFooter.SetTextColor("#757575");
    layMain.AddChild(txtFooter);

    app.AddLayout(layMain);

    // System Tray replacement: Android Ongoing Notification
    try {
        notify = app.CreateNotification("Ongoing");
    } catch (e) {}
}

function UpdateStatusUI() {
    let ip = app.GetIPAddress() || "127.0.0.1";
    let stateStr = g_bRunning ? "RUNNING" : "STOPPED";
    let info = `Status: ${stateStr}  |  IP: ${ip}  |  AET: ${g_aeCalled.trim()}\n` +
               `HTTP: :${g_HttpPort}  |  Telnet: :${g_TelnetPort}  |  DICOM: :${g_DicomPort}  |  Rows: ${Math.max(0, g_csvData.length - 1)}`;
    if (txtStatus) txtStatus.SetText(info);

    if (btnStartStop) {
        btnStartStop.SetText(g_bRunning ? "Stop Server" : "Start Server");
        btnStartStop.SetBackColor(g_bRunning ? "#2E7D32" : "#C62828");
    }

    if (notify) {
        notify.SetMessage(
            "RIS Multi-Protocol Server (" + stateStr + ")",
            `HTTP :${g_HttpPort} | DICOM :${g_DicomPort} | Telnet :${g_TelnetPort}`,
            `IP: ${ip}`
        );
        notify.Notify("ris_tray");
    }
}

// ===== Logging =====
function write_log(msg) {
    let now = new Date();
    let pad = (n, w = 2) => String(n).padStart(w, "0");
    let ts = `[${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
             `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}]`;
    let cleanMsg = String(msg).replace(/[\r\n]+$/, "");
    let line = `${ts} ${cleanMsg}`;

    if (g_DebugLog) {
        try {
            fs.appendFileSync(path.join(DATA_DIR, "ris_server.log"), line + "\n");
        } catch (e) {}
    }

    logLines.push(line);
    if (logLines.length > 200) logLines.shift();
    if (txtLog) txtLog.SetText(logLines.join("\n"));
}

// ===== Helpers =====
function TrimInPlace(str) {
    return (str || "").trim();
}

function StripDashes(str) {
    return (str || "").replace(/-/g, "");
}

function StripColons(str) {
    let res = (str || "").replace(/:/g, "");
    if (res.length === 4) res += "00";
    return res;
}

function FormatPatientName(name) {
    let pName = TrimInPlace(name);
    if (!pName || pName.includes("^")) return pName;

    let commaIdx = pName.indexOf(",");
    if (commaIdx !== -1) {
        let last = TrimInPlace(pName.slice(0, commaIdx));
        let rest = TrimInPlace(pName.slice(commaIdx + 1)).replace(/\s+/g, "^");
        let combined = `${last}^${rest}`.replace(/\^+$/, "");
        return combined;
    } else {
        let parts = pName.split(/\s+/);
        if (parts.length < 2) return pName;
        if (parts.length === 2) {
            return `${parts[1]}^${parts[0]}`;
        } else {
            let last = parts.pop();
            return `${last}^${parts.join("^")}`;
        }
    }
}

function StartsWithDISP(line) {
    return (line || "").slice(0, 4).toUpperCase() === "DISP";
}

function StrIEquals(a, b) {
    return String(a || "").toUpperCase() === String(b || "").toUpperCase();
}

function str_icontains(haystack, needle) {
    if (!needle) return true;
    return String(haystack || "").toLowerCase().includes(String(needle).toLowerCase());
}

function IsEightDigits(str) {
    return /^\d{8}$/.test(str || "");
}

function SetAETitle(src) {
    let clean = String(src || "AUTOIT_SCP").trim().slice(0, 31);
    g_aeCalled = clean.padEnd(31, " ");
}

// ===== Config (INI Read/Write) =====
function LoadConfig() {
    if (!fs.existsSync(szIniFile)) {
        SetAETitle("AUTOIT_SCP");
        SaveConfig();
        return;
    }
    try {
        let content = fs.readFileSync(szIniFile, "utf8");
        let map = {};
        content.split(/\r?\n/).forEach(line => {
            let eq = line.indexOf("=");
            if (eq > 0) {
                let k = line.slice(0, eq).trim().toLowerCase();
                let v = line.slice(eq + 1).trim();
                map[k] = v;
            }
        });
        SetAETitle(map["aetitle"] || "AUTOIT_SCP");
        g_delPwd = TrimInPlace(map["deletepassword"] || "0");
        g_omittedFields = TrimInPlace(map["omittedfields"] || "0");
        g_TelnetPort = parseInt(map["telnetport"] || "2323", 10);
        g_HttpPort = parseInt(map["httpport"] || "8080", 10);
        g_DicomPort = parseInt(map["dicomport"] || "1104", 10);
        g_TelnetTimeout = parseInt(map["telnettimeout"] || "10", 10);
        g_DebugLog = parseInt(map["debuglog"] || "1", 10);
    } catch (e) {
        write_log("Failed to load INI: " + e.message);
    }
}

function SaveConfig() {
    let ini = `[Server]\r\n` +
              `AETitle=${g_aeCalled.trim()}\r\n` +
              `DeletePassword=${g_delPwd}\r\n` +
              `omittedfields=${g_omittedFields}\r\n` +
              `TelnetPort=${g_TelnetPort}\r\n` +
              `HttpPort=${g_HttpPort}\r\n` +
              `DicomPort=${g_DicomPort}\r\n` +
              `TelnetTimeout=${g_TelnetTimeout}\r\n` +
              `DebugLog=${g_DebugLog}\r\n`;
    try {
        fs.writeFileSync(szIniFile, ini, "utf8");
    } catch (e) {
        write_log("Error saving INI: " + e.message);
    }
}

// ===== CSV Store Functions =====
function ParseCSVLineToEntry(pLine) {
    let entry = new Array(FIELD_COUNT).fill("");
    let fieldIdx = 0;
    let quoteState = false;
    let cur = "";
    let line = String(pLine || "").replace(/[\r\n]+$/, "");

    for (let i = 0; i < line.length; i++) {
        let ch = line[i];
        if (ch === "~") ch = '"';
        if (ch === '"') {
            quoteState = !quoteState;
            continue;
        }
        if (ch === "," && !quoteState) {
            entry[fieldIdx] = TrimInPlace(cur);
            cur = "";
            fieldIdx++;
            if (fieldIdx >= FIELD_COUNT) break;
            continue;
        }
        cur += ch;
    }
    if (fieldIdx < FIELD_COUNT) {
        entry[fieldIdx] = TrimInPlace(cur);
    }
    return entry;
}

function ValidateEntry(entry) {
    return entry && entry[8] && entry[8].length > 0;
}

function BuildCSVLineFromEntry(entry) {
    let out = [];
    for (let i = 0; i < FIELD_COUNT; i++) {
        let f = String(entry[i] || "");
        if (f.includes(",") || f.includes('"')) {
            out.push('"' + f.replace(/"/g, '""') + '"');
        } else {
            out.push(f);
        }
    }
    return out.join(",");
}

function EnsureCsvInitialized() {
    if (g_csvInitialized) return;
    g_csvInitialized = true;
    g_csvData = [szCSVHeader];
}

function AccessionEquals(line, accession) {
    let tempEntry = ParseCSVLineToEntry(line);
    return tempEntry[8] === accession;
}

function GenerateStudyUIDIfNeeded(entry) {
    if (!entry[26] || entry[26].length === 0) {
        let ticks = Date.now() & 0xFFFFFFFF;
        let r = Math.floor(Math.random() * 10000);
        entry[26] = `1.2.840.113619.2.1.${ticks >>> 0}.${r}`;
    }
}

function NormalizeAndSaveEntry(entry) {
    entry[2] = StripDashes(entry[2]);
    entry[12] = StripDashes(entry[12]);
    entry[13] = StripColons(entry[13]);
    entry[0] = FormatPatientName(entry[0]);
    GenerateStudyUIDIfNeeded(entry);

    let lineOut = BuildCSVLineFromEntry(entry);
    EnsureCsvInitialized();
    let acc = entry[8];
    let found = false;

    for (let i = 1; i < g_csvData.length; i++) {
        if (AccessionEquals(g_csvData[i], acc)) {
            g_csvData[i] = lineOut;
            found = true;
            break;
        }
    }
    if (!found && g_csvData.length < MAX_CSV_ROWS) {
        g_csvData.push(lineOut);
    }
    UpdateStatusUI();
    return found;
}

// ===== Procedure Codes Loading =====
function LoadProcedureCodes() {
    let filePath = path.join(DATA_DIR, "procedurecodes.csv");
    g_procCodes = [];
    if (!fs.existsSync(filePath)) {
        g_procCodesLoaded = true;
        return;
    }
    try {
        let lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
        for (let i = 1; i < lines.length && g_procCodes.length < MAX_PROC_CODES; i++) {
            let line = lines[i].trim();
            if (!line) continue;
            let parts = line.split(",");
            g_procCodes.push({
                id: TrimInPlace(parts[0] || ""),
                procCode: TrimInPlace(parts[1] || ""),
                modality: TrimInPlace(parts[2] || ""),
                name: TrimInPlace(parts.slice(3).join(",") || "")
            });
        }
        g_procCodesLoaded = true;
        write_log("Procedure codes loaded (" + g_procCodes.length + ")");
    } catch (e) {
        g_procCodesLoaded = true;
    }
}

// ===== Patient Directory (patients.csv) Encoding & Lookup =====
function load_and_convert_csv(filename) {
    let fullPath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(fullPath)) return null;
    try {
        let buf = fs.readFileSync(fullPath);
        if (buf.length === 0) return null;
        if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
            return buf.slice(3).toString("utf8");
        }
        if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
            return buf.slice(2).toString("utf16le");
        }
        if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) {
            // UTF-16BE swap to LE
            let swapped = Buffer.alloc(buf.length - 2);
            for (let i = 2; i + 1 < buf.length; i += 2) {
                swapped[i - 2] = buf[i + 1];
                swapped[i - 1] = buf[i];
            }
            return swapped.toString("utf16le");
        }
        return buf.toString("utf8");
    } catch (e) {
        return null;
    }
}

function get_csv_field(line, target_col) {
    let current_col = 0, in_quotes = false, out = "";
    for (let i = 0; i < line.length && current_col <= target_col; i++) {
        let c = line[i];
        if (c === '"') {
            in_quotes = !in_quotes;
        } else if (c === "," && !in_quotes) {
            if (current_col === target_col) break;
            current_col++;
        } else if (current_col === target_col) {
            out += c;
        }
    }
    return current_col === target_col ? TrimInPlace(out) : null;
}

function init_patients_csv() {
    if (patients_csv_data === null) {
        patients_csv_data = load_and_convert_csv("patients.csv");
        if (!patients_csv_data) return -1;

        let firstLine = patients_csv_data.split(/\r?\n/)[0] || "";
        let col_idx = 0;
        pts_name_col_idx = -1;
        while (true) {
            let field = get_csv_field(firstLine, col_idx);
            if (field === null || (field === "" && col_idx > 20)) break;
            if (str_icontains(field, "Birth") || str_icontains(field, "DOB")) pts_birthdate_col_idx = col_idx;
            else if (str_icontains(field, "Sex") || str_icontains(field, "Gender")) pts_sex_col_idx = col_idx;
            else if (str_icontains(field, "ID") || str_icontains(field, "PatID")) pts_id_col_idx = col_idx;
            else if ((str_icontains(field, "Name") || str_icontains(field, "Patient")) && pts_name_col_idx === -1) {
                pts_name_col_idx = col_idx;
            }
            col_idx++;
            if (col_idx > 50) break;
        }
        if (pts_name_col_idx < 0) {
            pts_name_col_idx = 0;
            pts_id_col_idx = 1;
            pts_birthdate_col_idx = 2;
            pts_sex_col_idx = 3;
        }
    }
    return 0;
}

function get_patient_names(filter, max_count) {
    if (init_patients_csv() !== 0) return null;
    let lines = patients_csv_data.split(/\r?\n/);
    let result = [];
    for (let i = 1; i < lines.length; i++) {
        let line = lines[i].trim();
        if (!line) continue;
        let name = get_csv_field(line, pts_name_col_idx);
        if (name) {
            if (filter && !str_icontains(name, filter)) continue;
            result.push(name);
            if (max_count > 0 && result.length >= max_count) break;
        }
    }
    return result;
}

function get_patient_details(patient_name) {
    if (init_patients_csv() !== 0) return null;
    let lines = patients_csv_data.split(/\r?\n/);
    for (let i = 1; i < lines.length; i++) {
        let line = lines[i].trim();
        if (!line) continue;
        let name = get_csv_field(line, pts_name_col_idx);
        if (name && StrIEquals(name, patient_name)) {
            return {
                patient_id: pts_id_col_idx >= 0 ? (get_csv_field(line, pts_id_col_idx) || "") : "",
                name: name,
                birthdate: pts_birthdate_col_idx >= 0 ? (get_csv_field(line, pts_birthdate_col_idx) || "") : "",
                sex: pts_sex_col_idx >= 0 ? (get_csv_field(line, pts_sex_col_idx) || "") : ""
            };
        }
    }
    return null;
}

// ===== DICOM Protocol Builder & Parser =====
function dicom_add_str(arr, g, e, s) {
    let str = String(s || "");
    let strBuf = Buffer.from(str, "utf8");
    let pad = (strBuf.length % 2 === 1) ? 1 : 0;
    let tot = strBuf.length + pad;
    let b = Buffer.alloc(8 + tot);
    b.writeUInt16LE(g, 0);
    b.writeUInt16LE(e, 2);
    b.writeUInt32LE(tot, 4);
    if (strBuf.length > 0) strBuf.copy(b, 8);
    if (pad) b[8 + strBuf.length] = 0x20; // space padding
    arr.push(b);
}

function dicom_add_us(arr, g, e, v) {
    let b = Buffer.alloc(10);
    b.writeUInt16LE(g, 0);
    b.writeUInt16LE(e, 2);
    b.writeUInt32LE(2, 4);
    b.writeUInt16LE(v & 0xFFFF, 8);
    arr.push(b);
}

function dicom_add_ul(arr, g, e, v) {
    let b = Buffer.alloc(12);
    b.writeUInt16LE(g, 0);
    b.writeUInt16LE(e, 2);
    b.writeUInt32LE(4, 4);
    b.writeUInt32LE(v >>> 0, 8);
    arr.push(b);
}

function dicom_seq_hdr(arr, g, e) {
    let b = Buffer.alloc(8);
    b.writeUInt16LE(g, 0);
    b.writeUInt16LE(e, 2);
    b.writeUInt32LE(0xFFFFFFFF, 4);
    arr.push(b);
}

function dicom_item_hdr(arr) {
    arr.push(Buffer.from([0xFE, 0xFF, 0x00, 0xE0, 0xFF, 0xFF, 0xFF, 0xFF]));
}

function dicom_item_delim(arr) {
    arr.push(Buffer.from([0xFE, 0xFF, 0x0D, 0xE0, 0x00, 0x00, 0x00, 0x00]));
}

function dicom_seq_delim(arr) {
    arr.push(Buffer.from([0xFE, 0xFF, 0xDD, 0xE0, 0x00, 0x00, 0x00, 0x00]));
}

function send_pdata_tf(sock, pc_id, msg_ctrl, dataBuf) {
    let data_len = dataBuf.length;
    let pdv_len = 2 + data_len;
    let pdu_len = 4 + pdv_len;
    let pdu = Buffer.alloc(6 + pdu_len);

    pdu[0] = 0x04;
    pdu[1] = 0x00;
    pdu.writeUInt32BE(pdu_len, 2);
    pdu.writeUInt32BE(pdv_len, 6);
    pdu[10] = pc_id;
    pdu[11] = msg_ctrl;
    dataBuf.copy(pdu, 12);
    sock.write(pdu);
}

function dicom_get_string(buf, g, e) {
    let tg0 = g & 0xFF, tg1 = (g >> 8) & 0xFF;
    let tg2 = e & 0xFF, tg3 = (e >> 8) & 0xFF;
    let VRs = new Set(["DA","TM","CS","SH","LO","PN","UI","AE","AS","IS","DS","ST","LT","UT","OB","OW","SQ","UN","FD","FL","SL","SS","UL","US"]);

    for (let i = 0; i <= buf.length - 8; i++) {
        if (buf[i] === tg0 && buf[i+1] === tg1 && buf[i+2] === tg2 && buf[i+3] === tg3) {
            let v1 = String.fromCharCode(buf[i+4]);
            let v2 = String.fromCharCode(buf[i+5]);
            let vr = v1 + v2;
            let vlen = 0, offset = 8;

            if (VRs.has(vr)) {
                if (vr === "OB" || vr === "OW" || vr === "SQ" || vr === "UN") {
                    if (i + 12 > buf.length) break;
                    vlen = buf.readUInt32LE(i + 8);
                    offset = 12;
                } else {
                    vlen = buf.readUInt16LE(i + 6);
                    offset = 8;
                }
            } else {
                vlen = buf.readUInt32LE(i + 4);
                offset = 8;
            }

            if (vlen > 0 && vlen < 128 && i + offset + vlen <= buf.length) {
                let raw = buf.slice(i + offset, i + offset + vlen).toString("utf8");
                return raw.replace(/[\0 ]+$/, "");
            }
        }
    }
    return "";
}

function is_field_omitted(g, e) {
    if (!g_omittedFields || g_omittedFields === "0") return false;
    let tagStr = g.toString(16).padStart(4, "0").toUpperCase() + e.toString(16).padStart(4, "0").toUpperCase();
    let tokens = g_omittedFields.split(/[, ]+/);
    for (let t of tokens) {
        if (StrIEquals(t.trim(), tagStr)) return true;
    }
    return false;
}

function handle_association_rq(sock, buffer) {
    write_log("Parsing A-ASSOCIATE-RQ...");
    if (buffer.length < 42) return;

    let ac_pdu = Buffer.alloc(2048, 0);
    ac_pdu[0] = 0x02;
    ac_pdu[1] = 0x00;
    ac_pdu[6] = 0x00;
    ac_pdu[7] = 0x01;
    buffer.copy(ac_pdu, 10, 10, 26); // Called AE
    buffer.copy(ac_pdu, 26, 26, 42); // Calling AE

    let offset = 74;
    let app_ctx = Buffer.from([0x10, 0x00, 0x00, 0x15, ...Buffer.from("1.2.840.10008.3.1.1.1")]);
    app_ctx.copy(ac_pdu, offset);
    offset += app_ctx.length;

    let i = 74;
    while (i <= buffer.length - 4) {
        let item_type = buffer[i];
        let item_len = buffer.readUInt16BE(i + 2);
        if (item_type === 0x20 && i + 4 + item_len <= buffer.length) {
            write_log("Accepting PC ID " + buffer[i + 4]);
            let pc_id = buffer[i + 4];
            ac_pdu[offset++] = 0x21;
            ac_pdu[offset++] = 0x00;
            ac_pdu[offset++] = 0x00;
            ac_pdu[offset++] = 0x19;
            ac_pdu[offset++] = pc_id;
            ac_pdu[offset++] = 0x00;
            ac_pdu[offset++] = 0x00;
            ac_pdu[offset++] = 0x00;
            let ts = Buffer.from([0x40, 0x00, 0x00, 0x11, ...Buffer.from("1.2.840.10008.1.2")]);
            ts.copy(ac_pdu, offset);
            offset += ts.length;
        }
        i += 4 + item_len;
    }

    let user_info = Buffer.from([
        0x50, 0x00, 0x00, 0x1E,
        0x51, 0x00, 0x00, 0x04, 0x00, 0x00, 0x40, 0x00,
        0x52, 0x00, 0x00, 0x12, ...Buffer.from("1.2.276.0.723.1.99")
    ]);
    user_info.copy(ac_pdu, offset);
    offset += user_info.length;

    let pdu_len = offset - 6;
    ac_pdu.writeUInt32BE(pdu_len, 2);
    sock.write(ac_pdu.slice(0, offset));
}

function handle_c_echo_rq(sock, pc_id, msg_id) {
    let chunks = [];
    dicom_add_ul(chunks, 0x0000, 0x0000, 0);
    dicom_add_str(chunks, 0x0000, 0x0002, "1.2.840.10008.1.1");
    dicom_add_us(chunks, 0x0000, 0x0100, 0x8030);
    dicom_add_us(chunks, 0x0000, 0x0120, msg_id);
    dicom_add_us(chunks, 0x0000, 0x0800, 0x0101);
    dicom_add_us(chunks, 0x0000, 0x0900, 0x0000);

    let cmdBuf = Buffer.concat(chunks);
    cmdBuf.writeUInt32LE(cmdBuf.length - 12, 8);
    send_pdata_tf(sock, pc_id, 0x03, cmdBuf);
}

function handle_c_find_rq(sock, pc_id, msg_id, reqBuf) {
    let qMod = dicom_get_string(reqBuf, 0x0008, 0x0060);
    let qAET = dicom_get_string(reqBuf, 0x0040, 0x0001);
    let qDate = dicom_get_string(reqBuf, 0x0040, 0x0002);
    let qTime = dicom_get_string(reqBuf, 0x0040, 0x0003);

    EnsureCsvInitialized();

    for (let row = 1; row < g_csvData.length; row++) {
        let f = ParseCSVLineToEntry(g_csvData[row]);
        let e = {
            patientName: f[0], patientID: f[1], dob: f[2], sex: f[3],
            reqPhys: f[4], reqSvc: f[5], procDesc: f[6], procReason: f[7],
            accNum: f[8], procID: f[9], procPri: f[10], aeTitle: f[11],
            spsDate: f[12], spsTime: f[13], perfPhys: f[14], spsDesc: f[15],
            spsID: f[16], station: f[17], loc: f[18], status: f[19],
            modality: f[20], refPhys: f[21], studyDesc: f[22], protoCode: f[23],
            protoScheme: f[24], protoMeaning: f[25], studyUID: f[26]
        };

        // Only output patients from ARRIVED (2) through STARTED (4)
        let statCode = parseInt(e.status || "0", 10);
        if (statCode < 2 || statCode > 4) continue;

        if (qMod && qMod !== e.modality) continue;
        if (qAET && qAET !== e.aeTitle) continue;

        if (qDate) {
            let dashIdx = qDate.indexOf("-");
            if (dashIdx !== -1) {
                let d1 = qDate.slice(0, dashIdx);
                let d2 = qDate.slice(dashIdx + 1);
                if (d1 && e.spsDate < d1) continue;
                if (d2 && e.spsDate > d2) continue;
            } else if (e.spsDate !== qDate) {
                continue;
            }
        }

        if (qTime) {
            let dashIdx = qTime.indexOf("-");
            if (dashIdx !== -1) {
                let t1 = qTime.slice(0, dashIdx);
                let t2 = qTime.slice(dashIdx + 1);
                if (t1 && e.spsTime < t1) continue;
                if (t2 && e.spsTime > t2) continue;
            } else if (!e.spsTime.startsWith(qTime)) {
                continue;
            }
        }

        // Send C-FIND-RSP (Pending 0xFF00)
        let cmdChunks = [];
        dicom_add_ul(cmdChunks, 0x0000, 0x0000, 0);
        dicom_add_str(cmdChunks, 0x0000, 0x0002, "1.2.840.10008.5.1.4.31");
        dicom_add_us(cmdChunks, 0x0000, 0x0100, 0x8020);
        dicom_add_us(cmdChunks, 0x0000, 0x0120, msg_id);
        dicom_add_us(cmdChunks, 0x0000, 0x0800, 0x0102);
        dicom_add_us(cmdChunks, 0x0000, 0x0900, 0xFF00);
        let cmdBuf = Buffer.concat(cmdChunks);
        cmdBuf.writeUInt32LE(cmdBuf.length - 12, 8);
        send_pdata_tf(sock, pc_id, 0x03, cmdBuf);

        // Build DICOM Dataset
        let dataChunks = [];
        if (!is_field_omitted(0x0008, 0x0050)) dicom_add_str(dataChunks, 0x0008, 0x0050, e.accNum);
        if (!is_field_omitted(0x0008, 0x0090)) dicom_add_str(dataChunks, 0x0008, 0x0090, e.refPhys);
        if (!is_field_omitted(0x0010, 0x0010)) dicom_add_str(dataChunks, 0x0010, 0x0010, e.patientName);
        if (!is_field_omitted(0x0010, 0x0020)) dicom_add_str(dataChunks, 0x0010, 0x0020, e.patientID);
        if (!is_field_omitted(0x0010, 0x0030)) dicom_add_str(dataChunks, 0x0010, 0x0030, e.dob);
        if (!is_field_omitted(0x0020, 0x000D)) dicom_add_str(dataChunks, 0x0020, 0x000D, e.studyUID);
        if (!is_field_omitted(0x0032, 0x1060)) dicom_add_str(dataChunks, 0x0032, 0x1060, e.procDesc);

        dicom_seq_hdr(dataChunks, 0x0040, 0x0100);
        dicom_item_hdr(dataChunks);
        if (!is_field_omitted(0x0008, 0x0060)) dicom_add_str(dataChunks, 0x0008, 0x0060, e.modality);
        if (!is_field_omitted(0x0040, 0x0001)) dicom_add_str(dataChunks, 0x0040, 0x0001, e.aeTitle);
        if (!is_field_omitted(0x0040, 0x0002)) dicom_add_str(dataChunks, 0x0040, 0x0002, e.spsDate);
        if (!is_field_omitted(0x0040, 0x0003)) dicom_add_str(dataChunks, 0x0040, 0x0003, e.spsTime);
        if (!is_field_omitted(0x0040, 0x0007)) dicom_add_str(dataChunks, 0x0040, 0x0007, e.spsDesc);

        dicom_seq_hdr(dataChunks, 0x0040, 0x0008);
        dicom_item_hdr(dataChunks);
        if (!is_field_omitted(0x0008, 0x0100)) dicom_add_str(dataChunks, 0x0008, 0x0100, e.protoCode);
        if (!is_field_omitted(0x0008, 0x0102)) dicom_add_str(dataChunks, 0x0008, 0x0102, e.protoScheme);
        if (!is_field_omitted(0x0008, 0x0104)) dicom_add_str(dataChunks, 0x0008, 0x0104, e.protoMeaning);
        dicom_item_delim(dataChunks);
        dicom_seq_delim(dataChunks);

        if (!is_field_omitted(0x0040, 0x0009)) dicom_add_str(dataChunks, 0x0040, 0x0009, e.spsID);
        dicom_item_delim(dataChunks);
        dicom_seq_delim(dataChunks);

        if (!is_field_omitted(0x0040, 0x1001)) dicom_add_str(dataChunks, 0x0040, 0x1001, e.procID);

        send_pdata_tf(sock, pc_id, 0x02, Buffer.concat(dataChunks));
    }

    // Final C-FIND-RSP (Success 0x0000)
    let endChunks = [];
    dicom_add_ul(endChunks, 0x0000, 0x0000, 0);
    dicom_add_str(endChunks, 0x0000, 0x0002, "1.2.840.10008.5.1.4.31");
    dicom_add_us(endChunks, 0x0000, 0x0100, 0x8020);
    dicom_add_us(endChunks, 0x0000, 0x0120, msg_id);
    dicom_add_us(endChunks, 0x0000, 0x0800, 0x0101);
    dicom_add_us(endChunks, 0x0000, 0x0900, 0x0000);
    let endBuf = Buffer.concat(endChunks);
    endBuf.writeUInt32LE(endBuf.length - 12, 8);
    send_pdata_tf(sock, pc_id, 0x03, endBuf);
}

// ===== Server 1: DICOM SCP =====
function StartDicomServer() {
    g_serverDicom = net.createServer(sock => {
        write_log("DICOM SCU connected.");
        let rxBuf = Buffer.alloc(0);
        let findCmd = Buffer.alloc(0);
        let findData = Buffer.alloc(0);
        let findPcId = 0;
        let findMsgId = 0;
        let findCommand = 0;

        sock.on("data", chunk => {
            rxBuf = Buffer.concat([rxBuf, chunk]);
            while (rxBuf.length >= 6) {
                let pdu_len = rxBuf.readUInt32BE(2);
                if (rxBuf.length < 6 + pdu_len) break;

                let pdu = rxBuf.slice(0, 6 + pdu_len);
                rxBuf = rxBuf.slice(6 + pdu_len);

                let pduType = pdu[0];
                if (pduType === 0x01) {
                    handle_association_rq(sock, pdu);
                } else if (pduType === 0x04) {
                    let pos = 6;
                    let end = pdu.length;
                    while (pos + 6 <= end) {
                        let pdv_len = pdu.readUInt32BE(pos);
                        let pc_id = pdu[pos + 4];
                        let msg_ctrl = pdu[pos + 5];
                        let data_off = pos + 6;
                        let data_len = pdv_len - 2;
                        if (data_len < 0 || data_off + data_len > end) break;

                        let frag = pdu.slice(data_off, data_off + data_len);
                        let is_command = (msg_ctrl & 0x01) !== 0;
                        let is_last_frag = (msg_ctrl & 0x02) !== 0;

                        if (is_command) {
                            findCmd = Buffer.concat([findCmd, frag]);
                            findPcId = pc_id;
                            if (is_last_frag) {
                                findCommand = 0;
                                findMsgId = 0;
                                for (let i = 0; i <= findCmd.length - 10; i++) {
                                    if (findCmd[i] === 0x00 && findCmd[i+1] === 0x00 &&
                                        findCmd[i+2] === 0x00 && findCmd[i+3] === 0x01 &&
                                        findCmd[i+4] === 0x02 && findCmd[i+5] === 0x00) {
                                        findCommand = findCmd.readUInt16LE(i + 8);
                                    }
                                    if (findCmd[i] === 0x00 && findCmd[i+1] === 0x00 &&
                                        findCmd[i+2] === 0x20 && findCmd[i+3] === 0x01 &&
                                        findCmd[i+4] === 0x02 && findCmd[i+5] === 0x00) {
                                        findMsgId = findCmd.readUInt16LE(i + 8);
                                    }
                                }
                                if (findCommand === 0x0030) {
                                    handle_c_echo_rq(sock, findPcId, findMsgId);
                                    findCmd = Buffer.alloc(0);
                                    findData = Buffer.alloc(0);
                                }
                            }
                        } else {
                            findData = Buffer.concat([findData, frag]);
                            if (is_last_frag) {
                                if (findCommand === 0x0020) {
                                    handle_c_find_rq(sock, findPcId, findMsgId, findData);
                                }
                                findCmd = Buffer.alloc(0);
                                findData = Buffer.alloc(0);
                            }
                        }
                        pos += 4 + pdv_len;
                    }
                } else if (pduType === 0x05) {
                    sock.write(Buffer.from([0x06, 0x00, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00]));
                    sock.end();
                } else if (pduType === 0x02) {
                    sock.write(Buffer.from([0x03, 0x00, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x02]));
                    sock.end();
                }
            }
        });

        sock.on("error", () => {});
    });

    g_serverDicom.on("error", err => {
        if (err.code === "EACCES" && g_DicomPort < 1024) {
            write_log(`Port ${g_DicomPort} requires root on Android. Falling back to 1104.`);
            g_DicomPort = 1104;
            g_serverDicom.listen(g_DicomPort, "0.0.0.0");
            UpdateStatusUI();
        } else {
            write_log(`ERROR: Failed to listen on DICOM port ${g_DicomPort}: ${err.message}`);
        }
    });

    g_serverDicom.listen(g_DicomPort, "0.0.0.0", () => {
        write_log(`DICOM SCP listening on port ${g_DicomPort}`);
        UpdateStatusUI();
    });
}

// ===== Server 2: Telnet Server =====
function LineMatchesDisp(line, param) {
    if (!param) return true;
    let tempEntry = ParseCSVLineToEntry(line);
    if (StrIEquals(tempEntry[20], param)) return true; // Modality
    if (StrIEquals(tempEntry[11], param)) return true; // StationAE
    if (IsEightDigits(param) && tempEntry[1] === param) return true; // PatientID
    return false;
}

function StartTelnetServer() {
    g_serverTelnet = net.createServer(sock => {
        g_telnetClients.add(sock);
        write_log(`Telnet Client connected (${sock.remoteAddress})`);
        sock.write("Connected to RIS Telnet Server. Waiting for data...\r\n");

        sock.setTimeout((g_TelnetTimeout || 10) * 1000);
        sock.on("timeout", () => {
            write_log("Telnet client timed out");
            sock.destroy();
        });

        let lineBuf = "";
        sock.on("data", chunk => {
            lineBuf += chunk.toString("utf8");
            let idx;
            while ((idx = lineBuf.indexOf("\n")) !== -1) {
                let rawLine = lineBuf.slice(0, idx).replace(/\r/g, "");
                lineBuf = lineBuf.slice(idx + 1);

                let pLine = TrimInPlace(rawLine);
                if (!pLine) continue;

                if (StartsWithDISP(pLine)) {
                    let dispParam = TrimInPlace(pLine.slice(4).split(",")[0] || "");
                    write_log("DISP query received");
                    EnsureCsvInitialized();
                    let count = 0;
                    for (let i = 1; i < g_csvData.length; i++) {
                        if (LineMatchesDisp(g_csvData[i], dispParam)) {
                            sock.write(g_csvData[i] + "\r\n");
                            count++;
                        }
                    }
                    sock.write(`${count} RESULTS\r\n`);
                } else {
                    let entry = ParseCSVLineToEntry(pLine);
                    if (!ValidateEntry(entry)) {
                        sock.write("INVALID LINE\r\n");
                    } else {
                        let found = NormalizeAndSaveEntry(entry);
                        if (found) {
                            sock.write("UPDATED\r\n");
                            write_log(`UPDATED Accession ${entry[8]}`);
                        } else {
                            sock.write("INSERTED\r\n");
                            write_log(`INSERTED Accession ${entry[8]}`);
                        }
                    }
                }
            }
        });

        sock.on("close", () => {
            g_telnetClients.delete(sock);
        });
        sock.on("error", () => {
            g_telnetClients.delete(sock);
        });
    });

    g_serverTelnet.on("error", err => {
        if (err.code === "EACCES" && g_TelnetPort < 1024) {
            write_log(`Port ${g_TelnetPort} requires root on Android. Falling back to 2323.`);
            g_TelnetPort = 2323;
            g_serverTelnet.listen(g_TelnetPort, "0.0.0.0");
            UpdateStatusUI();
        } else {
            write_log(`ERROR: Failed to listen on Telnet port ${g_TelnetPort}: ${err.message}`);
        }
    });

    g_serverTelnet.listen(g_TelnetPort, "0.0.0.0", () => {
        write_log(`Telnet listening on port ${g_TelnetPort}`);
        UpdateStatusUI();
    });
}

// ===== Server 3: HTTP Worklist Manager Server =====
function BuildMainHtmlPage() {
    EnsureCsvInitialized();
    let html = szHtmlStart;

    html += `<div style='margin-bottom:10px; display:flex; flex-wrap:wrap; gap:5px;'>
        <button onclick="filterStatus('')" class='top-btn' style='background:#555555;'>ALL</button>
        <button onclick="filterStatus('0')" class='top-btn' style='background:#9e9e9e;'>NONE</button>
        <button onclick="filterStatus('1')" class='top-btn' style='background:#2196F3;'>SCHEDULED</button>
        <button onclick="filterStatus('2')" class='top-btn' style='background:#ff9800;'>ARRIVED</button>
        <button onclick="filterStatus('3')" class='top-btn' style='background:#9c27b0;'>READY</button>
        <button onclick="filterStatus('4')" class='top-btn' style='background:#4CAF50;'>STARTED</button>
        <button onclick="filterStatus('5')" class='top-btn' style='background:#f44336;'>DEPARTED</button>
    </div>`;

    html += "<div style='overflow-x:auto;'><table id='pTable'>";
    for (let ri = 0; ri < g_csvData.length; ri++) {
        let isHeader = (ri === 0);
        let entry = ParseCSVLineToEntry(g_csvData[ri]);
        html += isHeader ? "<tr>" : "<tr onclick='f(this)' style='cursor:pointer;'>";
        for (let fi = 0; fi < FIELD_COUNT; fi++) {
            html += isHeader ? `<th onclick='sortTable(this.cellIndex)'>${entry[fi]}</th>` : `<td>${entry[fi]}</td>`;
        }
        html += "</tr>";
    }
    html += "</table></div><script>formatDates();</script>";

    html += szHtmlFormsTop;

    // Patient directory & procedure code filters
    html += `<div style='display:flex; flex-wrap:wrap; gap:20px; margin-bottom:15px;'>
    <div>
        <input type='text' id='patientFilter' oninput='filterPatients()' placeholder='Filter patients...' style='width: 300px; display: block; margin-bottom: 5px; padding: 5px;'>
        <select id='patientSel' size='5' onchange='loadPatientDetails(this.value)' style='width: 300px; vertical-align:top;'></select>
    </div>
    <div>
        <input type='text' id='procFilter' onkeyup='filterProcCodes()' placeholder='Filter procedure codes...' style='width: 300px; display: block; margin-bottom: 5px; padding: 5px;'>
        <select id='procCodeSel' multiple size='5' onchange="loadProcCode()" style='width: 300px; vertical-align:top; margin-bottom: 15px;'>`;

    if (g_procCodesLoaded) {
        for (let pc of g_procCodes) {
            html += `<option value='${pc.id}' data-id='${pc.id}' data-code='${pc.procCode}' data-mod='${pc.modality}'>${pc.name}</option>`;
        }
    }
    html += `</select></div></div>`;
    html += szHtmlFormsInputs;

    // Check rooms.csv
    let roomsPath = path.join(DATA_DIR, "rooms.csv");
    if (fs.existsSync(roomsPath)) {
        try {
            let rLines = fs.readFileSync(roomsPath, "utf8").split(/\r?\n/);
            let rData = [];
            for (let i = 1; i < rLines.length && rData.length < 64; i++) {
                let l = rLines[i].trim();
                if (!l) continue;
                let p = l.split(",").map(s => s.replace(/^[" ]+|[" ]+$/g, ""));
                rData.push({
                    id: p[0] || "", loc: p[1] || "", mod: p[2] || "",
                    ae: p[3] || "", name: p[4] || "", room: p[5] || ""
                });
            }
            html += `<script>var rData = ${JSON.stringify(rData)};
            function updR() {
                var idx = document.getElementsByName('StationName')[0].selectedIndex - 1;
                if(idx>=0) {
                    var r=rData[idx];
                    document.getElementsByName('Location')[0].value=r.room;
                    document.getElementsByName('Modality')[0].value=r.mod;
                    document.getElementsByName('StationAE')[0].value=r.ae;
                    document.getElementsByName('SPSID')[0].value=r.ae;
                    document.getElementsByName('ProcDesc')[0].value=r.name;
                }
            }</script>`;
            html += `<select name='StationName' onchange='updR()'><option value=''>Station Name</option>`;
            for (let r of rData) {
                html += `<option value="${r.name}">${r.name}</option>`;
            }
            html += `</select> <input type='text' name='Location' placeholder='Location'> `;
        } catch (e) {
            html += `<input type='text' name='StationName' placeholder='Station Name'> <input type='text' name='Location' placeholder='Location'> `;
        }
    } else {
        html += `<input type='text' name='StationName' placeholder='Station Name'> <input type='text' name='Location' placeholder='Location'> `;
    }

    html += szHtmlForms2;
    html += szHtmlEnd;
    return html;
}

function ProcessHttpRequest(sock, rawReq) {
    let headerEndIdx = rawReq.indexOf("\r\n\r\n");
    if (headerEndIdx === -1) return false;

    let headerPart = rawReq.slice(0, headerEndIdx);
    let bodyPart = rawReq.slice(headerEndIdx + 4);

    let clMatch = headerPart.match(/Content-Length:\s*(\d+)/i);
    if (clMatch) {
        let expectedLen = parseInt(clMatch[1], 10);
        if (Buffer.byteLength(bodyPart, "utf8") < expectedLen) {
            return false; // Wait for more chunks
        }
    }

    let firstLine = headerPart.split("\r\n")[0] || "";
    let [method, reqUrl] = firstLine.split(" ");
    reqUrl = reqUrl || "/";

    // API: /api/patient/<name>
    if (method === "GET" && reqUrl.startsWith("/api/patient/")) {
        let decodedName = decodeURIComponent(reqUrl.slice(13).replace(/\+/g, " "));
        let details = get_patient_details(decodedName);
        if (details) {
            sock.end("HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\nConnection: close\r\n\r\n" + JSON.stringify(details));
        } else {
            sock.end('HTTP/1.1 404 Not Found\r\nContent-Type: application/json; charset=utf-8\r\nConnection: close\r\n\r\n{"error": "Patient not found"}');
        }
        return true;
    }

    // API: /api/patients?filter=...
    if (method === "GET" && reqUrl.startsWith("/api/patients")) {
        let filter = "";
        let qIdx = reqUrl.indexOf("?");
        if (qIdx !== -1) {
            let params = new URLSearchParams(reqUrl.slice(qIdx + 1));
            filter = params.get("filter") || "";
        }
        let maxResults = filter.length > 0 ? 0 : 10;
        let names = get_patient_names(filter, maxResults);
        if (names !== null) {
            sock.end("HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\nConnection: close\r\n\r\n" + JSON.stringify(names));
        } else {
            sock.end("HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\nConnection: close\r\n\r\n[]");
        }
        return true;
    }

    // Main UI
    if (method === "GET") {
        let html = BuildMainHtmlPage();
        sock.end("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\n\r\n" + html);
        return true;
    }

    // POST handlers
    if (method === "POST") {
        if (reqUrl.startsWith("/delete")) {
            let m = bodyPart.match(/pwd=([^&\r\n]*)/);
            let inputPwd = m ? decodeURIComponent(m[1]) : "";
            if (inputPwd === g_delPwd) {
                g_csvData = [szCSVHeader];
                UpdateStatusUI();
                sock.end("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\n\r\n" +
                         szHtmlStart + "<meta http-equiv='refresh' content='1; url=/' /><h2>Data Deleted Successfully. Redirecting...</h2>" + szHtmlEnd);
            } else {
                sock.end("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\n\r\n" +
                         szHtmlStart + "<meta http-equiv='refresh' content='2; url=/' /><h2>Invalid Password! Redirecting...</h2>" + szHtmlEnd);
            }
            return true;
        }

        if (reqUrl.startsWith("/delpat")) {
            let acc = TrimInPlace(bodyPart);
            if (acc) {
                for (let i = 1; i < g_csvData.length; i++) {
                    if (AccessionEquals(g_csvData[i], acc)) {
                        g_csvData.splice(i, 1);
                        UpdateStatusUI();
                        break;
                    }
                }
            }
        } else if (reqUrl.startsWith("/manual")) {
            let cleanBody = TrimInPlace(bodyPart);
            if (cleanBody) {
                let entry = ParseCSVLineToEntry(cleanBody);
                if (ValidateEntry(entry)) {
                    NormalizeAndSaveEntry(entry);
                }
            }
        } else if (reqUrl.startsWith("/upload")) {
            let csvIdx = rawReq.indexOf(szCSVHeader);
            if (csvIdx !== -1) {
                let afterHeader = rawReq.slice(csvIdx + szCSVHeader.length);
                let lines = afterHeader.split(/\r?\n/);
                for (let line of lines) {
                    let trimmed = line.trim();
                    if (!trimmed) continue;
                    if (trimmed.startsWith("-")) break; // Multipart boundary
                    let entry = ParseCSVLineToEntry(trimmed);
                    if (ValidateEntry(entry)) {
                        NormalizeAndSaveEntry(entry);
                    }
                }
            }
        }

        sock.end("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\n\r\n" +
                 szHtmlStart + "<meta http-equiv='refresh' content='0; url=/' /><h2>Action Complete</h2>" + szHtmlEnd);
        return true;
    }

    sock.destroy();
    return true;
}

function StartHttpServer() {
    g_serverHttp = net.createServer(sock => {
        let reqBuf = "";
        sock.on("data", chunk => {
            reqBuf += chunk.toString("utf8");
            ProcessHttpRequest(sock, reqBuf);
        });
        sock.on("error", () => {});
    });

    g_serverHttp.on("error", err => {
        if (err.code === "EACCES" && g_HttpPort < 1024) {
            write_log(`Port ${g_HttpPort} requires root on Android. Falling back to 8080.`);
            g_HttpPort = 8080;
            g_serverHttp.listen(g_HttpPort, "0.0.0.0");
            UpdateStatusUI();
        } else {
            write_log(`ERROR: Failed to listen on HTTP port ${g_HttpPort}: ${err.message}`);
        }
    });

    g_serverHttp.listen(g_HttpPort, "0.0.0.0", () => {
        write_log(`HTTP listening on port ${g_HttpPort}`);
        UpdateStatusUI();
    });
}

// ===== Server Start / Stop Lifecycle =====
function ServerStart() {
    if (g_bRunning) return;
    StartTelnetServer();
    StartHttpServer();
    StartDicomServer();
    g_bRunning = true;
    write_log("Server STARTED");
    UpdateStatusUI();
}

function ServerStop() {
    if (!g_bRunning) return;
    for (let s of g_telnetClients) {
        try { s.destroy(); } catch (e) {}
    }
    g_telnetClients.clear();

    if (g_serverTelnet) { g_serverTelnet.close(); g_serverTelnet = null; }
    if (g_serverHttp) { g_serverHttp.close(); g_serverHttp = null; }
    if (g_serverDicom) { g_serverDicom.close(); g_serverDicom = null; }

    g_bRunning = false;
    write_log("Server STOPPED");
    UpdateStatusUI();
}

function ToggleServer() {
    if (g_bRunning) ServerStop();
    else ServerStart();
}

// ===== Built-In Web Manager Modal =====
function ShowWebManager() {
    if (!g_bRunning) {
        app.ShowPopup("Start the server first to open the Web Manager.");
        return;
    }
    dlgWeb = app.CreateDialog("RIS Worklist Web Manager", "FillXY");
    let layWeb = app.CreateLayout("Linear", "VCenter,FillXY");

    let web = app.CreateWebView(1.0, 0.9);
    web.LoadUrl(`http://127.0.0.1:${g_HttpPort}/`);
    layWeb.AddChild(web);

    let btnClose = app.CreateButton("Close Web Manager", 1.0, 0.08);
    btnClose.SetBackColor("#37474F");
    btnClose.SetTextColor("#FFFFFF");
    btnClose.SetOnTouch(function () {
        dlgWeb.Dismiss();
        UpdateStatusUI();
    });
    layWeb.AddChild(btnClose);

    dlgWeb.AddLayout(layWeb);
    dlgWeb.Show();
}

// ===== Settings Dialog (Port of SettingsWndProc) =====
function ShowSettingsDialog() {
    dlgSettings = app.CreateDialog("Server Settings");
    let layDlg = app.CreateLayout("Linear", "VCenter,FillXY");
    layDlg.SetPadding(0.04, 0.02, 0.04, 0.02);
    layDlg.SetBackColor("#263238");

    function addField(label, val, isNumber) {
        let row = app.CreateLayout("Linear", "Horizontal,FillX,VCenter");
        let lbl = app.CreateText(label, 0.38, -1, "Left");
        lbl.SetTextColor("#ECEFF1");
        row.AddChild(lbl);
        let edt = app.CreateTextEdit(String(val), 0.48, -1, isNumber ? "Numbers,SingleLine" : "SingleLine");
        edt.SetTextColor("#FFFFFF");
        row.AddChild(edt);
        layDlg.AddChild(row);
        return edt;
    }

    edtAet = addField("AET Title:", g_aeCalled.trim(), false);
    edtTelnet = addField("Telnet Port:", g_TelnetPort, true);
    edtHttp = addField("HTTP Port:", g_HttpPort, true);
    edtDicom = addField("DICOM Port:", g_DicomPort, true);
    edtTimeout = addField("Timeout (sec):", g_TelnetTimeout, true);
    edtPwd = addField("Delete Pwd:", g_delPwd, false);
    edtOmitted = addField("Omitted Tags:", g_omittedFields, false);

    chkDebug = app.CreateCheckBox("Enable Debug Log", 0.86, -1);
    chkDebug.SetMargins(0, 0.01, 0, 0.01);
    chkDebug.SetTextColor("#ECEFF1");
    chkDebug.SetChecked(g_DebugLog === 1);
    layDlg.AddChild(chkDebug);

    let layAct = app.CreateLayout("Linear", "Horizontal,Center");
    layAct.SetMargins(0, 0.02, 0, 0.01);

    let btnOk = app.CreateButton("OK", 0.38, 0.06);
    btnOk.SetBackColor("#009879");
    btnOk.SetTextColor("#FFFFFF");
    btnOk.SetOnTouch(function () {
        let wasRunning = g_bRunning;
        if (wasRunning) ServerStop();

        SetAETitle(edtAet.GetText());
        g_TelnetPort = parseInt(edtTelnet.GetText(), 10) || 2323;
        g_HttpPort = parseInt(edtHttp.GetText(), 10) || 8080;
        g_DicomPort = parseInt(edtDicom.GetText(), 10) || 1104;
        g_TelnetTimeout = parseInt(edtTimeout.GetText(), 10) || 10;
        g_delPwd = TrimInPlace(edtPwd.GetText()) || "0";
        g_omittedFields = TrimInPlace(edtOmitted.GetText()) || "0";
        g_DebugLog = chkDebug.GetChecked() ? 1 : 0;

        SaveConfig();
        dlgSettings.Dismiss();
        if (wasRunning) ServerStart();
        else UpdateStatusUI();
    });
    layAct.AddChild(btnOk);

    let btnCancel = app.CreateButton("Cancel", 0.38, 0.06);
    btnCancel.SetMargins(0.04, 0, 0, 0);
    btnCancel.SetBackColor("#546E7A");
    btnCancel.SetTextColor("#FFFFFF");
    btnCancel.SetOnTouch(function () {
        dlgSettings.Dismiss();
    });
    layAct.AddChild(btnCancel);

    layDlg.AddChild(layAct);
    dlgSettings.AddLayout(layDlg);
    dlgSettings.Show();
}