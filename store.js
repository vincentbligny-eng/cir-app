// ============================================================
// CIR App - Client-side data store (replaces Flask backend)
// Data persists in localStorage
// ============================================================

const STORE_KEY = 'cir_app_data';

function _loadStore() {
    try {
        const data = JSON.parse(localStorage.getItem(STORE_KEY));
        if (data && data.users) return data;
    } catch (e) {}
    return { users: [], projects: [], time_entries: [], custom_holidays: [] };
}

function _saveStore() {
    localStorage.setItem(STORE_KEY, JSON.stringify(_store));
}

let _store = _loadStore();
let _nextId = {
    users: Math.max(0, ..._store.users.map(r => r.id)) + 1,
    projects: Math.max(0, ..._store.projects.map(r => r.id)) + 1,
    time_entries: Math.max(0, ..._store.time_entries.map(r => r.id)) + 1,
    custom_holidays: Math.max(0, ..._store.custom_holidays.map(r => r.id)) + 1,
};

// --- French public holidays (Meeus Easter algorithm) ---

function _getFrenchHolidays(year) {
    const hols = {};
    const fmt = (m, d) => `${year}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    hols[fmt(1,1)]="Jour de l'An"; hols[fmt(5,1)]="Fete du Travail";
    hols[fmt(5,8)]="Victoire 1945"; hols[fmt(7,14)]="Fete Nationale";
    hols[fmt(8,15)]="Assomption"; hols[fmt(11,1)]="Toussaint";
    hols[fmt(11,11)]="Armistice"; hols[fmt(12,25)]="Noel";
    const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4;
    const f=Math.floor((b+8)/25),gg=Math.floor((b-f+1)/3);
    const h=(19*a+b-d-gg+15)%30,i=Math.floor(c/4),k=c%4;
    const l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);
    const month=Math.floor((h+l-7*m+114)/31),day=((h+l-7*m+114)%31)+1;
    const easter=new Date(year,month-1,day);
    function addD(dt,n){const r=new Date(dt);r.setDate(r.getDate()+n);return r;}
    function fmtD(dt){return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;}
    hols[fmtD(addD(easter,1))]="Lundi de Paques";
    hols[fmtD(addD(easter,39))]="Ascension";
    hols[fmtD(addD(easter,50))]="Lundi de Pentecote";
    return hols;
}

function _getHolidaysForWeek(weekStartStr) {
    const ws = new Date(weekStartStr + "T00:00:00");
    const french = _getFrenchHolidays(ws.getFullYear());
    const dayNames = ["monday","tuesday","wednesday","thursday","friday"];
    const result = {};
    for (let i = 0; i < 5; i++) {
        const d = new Date(ws); d.setDate(d.getDate() + i);
        const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        if (french[ds]) result[dayNames[i]] = french[ds];
        else {
            const ch = _store.custom_holidays.find(h => h.date === ds);
            if (ch) result[dayNames[i]] = ch.label;
        }
    }
    return result;
}

function _mondayOf(d) {
    const dt = new Date(d);
    const day = dt.getDay();
    dt.setDate(dt.getDate() + ((day===0?-6:1)-day));
    dt.setHours(0,0,0,0);
    return dt;
}

function _fmtDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// --- Local API router (replaces fetch to Flask backend) ---

async function api(url, opts = {}) {
    const method = (opts.method || "GET").toUpperCase();
    let body = opts.body;
    if (typeof body === "string") body = JSON.parse(body);

    const [path, qs] = url.split("?");
    const params = new URLSearchParams(qs || "");

    // --- Users ---
    if (path === "/api/users" && method === "GET")
        return [..._store.users].sort((a,b) => a.name.localeCompare(b.name));

    if (path === "/api/users" && method === "POST") {
        const name = (body.name||"").trim();
        if (!name) return {error:"Name required"};
        if (_store.users.some(u=>u.name===name)) return {error:"User already exists"};
        _store.users.push({id:_nextId.users++, name, time_unit:"hours"});
        _saveStore(); return {ok:true};
    }

    let m = path.match(/^\/api\/users\/(\d+)$/);
    if (m && method === "DELETE") {
        const uid = +m[1];
        _store.time_entries = _store.time_entries.filter(e=>e.user_id!==uid);
        _store.users = _store.users.filter(u=>u.id!==uid);
        _saveStore(); return {ok:true};
    }

    m = path.match(/^\/api\/users\/(\d+)\/time_unit$/);
    if (m && method === "PUT") {
        const u = _store.users.find(u=>u.id===+m[1]);
        if (u) u.time_unit = body.time_unit||"hours";
        _saveStore(); return {ok:true};
    }

    // --- Projects ---
    if (path === "/api/projects" && method === "GET")
        return [..._store.projects].sort((a,b) => a.name.localeCompare(b.name));

    if (path === "/api/projects" && method === "POST") {
        const name = (body.name||"").trim();
        if (!name) return {error:"Name required"};
        if (_store.projects.some(p=>p.name===name)) return {error:"Project already exists"};
        _store.projects.push({id:_nextId.projects++, name, description:body.description||"", active:1});
        _saveStore(); return {ok:true};
    }

    m = path.match(/^\/api\/projects\/(\d+)$/);
    if (m && method === "PUT") {
        const p = _store.projects.find(p=>p.id===+m[1]);
        if (p) { p.name=body.name; p.description=body.description||""; p.active=body.active!==undefined?+body.active:1; }
        _saveStore(); return {ok:true};
    }
    if (m && method === "DELETE") {
        const pid = +m[1];
        _store.time_entries = _store.time_entries.filter(e=>e.project_id!==pid);
        _store.projects = _store.projects.filter(p=>p.id!==pid);
        _saveStore(); return {ok:true};
    }

    // --- Holidays ---
    if (path === "/api/holidays" && method === "GET")
        return [..._store.custom_holidays].sort((a,b) => a.date.localeCompare(b.date));

    if (path === "/api/holidays" && method === "POST") {
        if (_store.custom_holidays.some(h=>h.date===body.date)) return {error:"Holiday exists"};
        _store.custom_holidays.push({id:_nextId.custom_holidays++, date:body.date, label:body.label||"Conge"});
        _saveStore(); return {ok:true};
    }

    m = path.match(/^\/api\/holidays\/(\d+)$/);
    if (m && method === "DELETE") {
        _store.custom_holidays = _store.custom_holidays.filter(h=>h.id!==+m[1]);
        _saveStore(); return {ok:true};
    }

    // --- Entries ---
    if (path === "/api/entries" && method === "GET") {
        const userId = +params.get("user_id"), weekStart = params.get("week_start");
        const user = _store.users.find(u=>u.id===userId);
        if (!user) return {error:"User not found"};
        const entries = _store.time_entries
            .filter(e=>e.user_id===userId && e.week_start===weekStart)
            .map(e=>({...e, project_name:(_store.projects.find(p=>p.id===e.project_id)||{}).name||"?"}));
        return {user, entries, holidays:_getHolidaysForWeek(weekStart), legal_hours_per_week:35, legal_hours_per_day:7};
    }

    if (path === "/api/entries" && method === "POST") {
        const {user_id, week_start, entries} = body;
        _store.time_entries = _store.time_entries.filter(e=>!(e.user_id===user_id && e.week_start===week_start));
        for (const e of entries) {
            _store.time_entries.push({
                id:_nextId.time_entries++, user_id, project_id:e.project_id, week_start,
                monday:+(e.monday||0), tuesday:+(e.tuesday||0), wednesday:+(e.wednesday||0),
                thursday:+(e.thursday||0), friday:+(e.friday||0),
            });
        }
        _saveStore(); return {ok:true};
    }

    // --- Monthly entries ---
    if (path === "/api/monthly_entries" && method === "GET") {
        const userId=+params.get("user_id"), year=+params.get("year"), month=+params.get("month");
        const user = _store.users.find(u=>u.id===userId);
        if (!user) return {error:"User not found"};
        const firstDay = new Date(year, month-1, 1);
        const lastDay = new Date(year, month, 0);
        const firstMon = _mondayOf(firstDay);
        const lastMon = _mondayOf(lastDay);
        const weeks = [];
        const d = new Date(firstMon);
        while (d <= lastMon) {
            const ws = _fmtDate(d);
            const entries = _store.time_entries.filter(e=>e.user_id===userId&&e.week_start===ws)
                .map(e=>({...e, project_name:(_store.projects.find(p=>p.id===e.project_id)||{}).name||"?"}));
            weeks.push({week_start:ws, entries, holidays:_getHolidaysForWeek(ws)});
            d.setDate(d.getDate()+7);
        }
        return {user, weeks, year, month};
    }

    // --- Summary ---
    if (path === "/api/summary" && method === "GET") {
        const weekStart = params.get("week_start") || _fmtDate(_mondayOf(new Date()));
        const holidays = _getHolidaysForWeek(weekStart);
        const expected = 35 - Object.keys(holidays).length * 7;
        const users = [..._store.users].sort((a,b)=>a.name.localeCompare(b.name));
        return {week_start:weekStart, holidays, users: users.map(u => {
            const entries = _store.time_entries.filter(e=>e.user_id===u.id&&e.week_start===weekStart)
                .map(e=>({...e, project_name:(_store.projects.find(p=>p.id===e.project_id)||{}).name||"?"}));
            const total = entries.reduce((s,e)=>s+e.monday+e.tuesday+e.wednesday+e.thursday+e.friday,0);
            return {user:u, total_hours:total, expected_hours:expected, complete:Math.abs(total-expected)<0.01, entries};
        })};
    }

    // --- Yearly ---
    if (path === "/api/yearly" && method === "GET") {
        const userId=+params.get("user_id"), year=+params.get("year");
        const firstDay=new Date(year,0,1), lastDay=new Date(year,11,31);
        const firstMon=_mondayOf(firstDay), lastMon=_mondayOf(lastDay);
        const entries = _store.time_entries.filter(e=>e.user_id===userId&&e.week_start>=_fmtDate(firstMon)&&e.week_start<=_fmtDate(lastMon));
        const dayNames=["monday","tuesday","wednesday","thursday","friday"];
        const daysData={};
        for (const e of entries) {
            const ws=new Date(e.week_start+"T00:00:00");
            const proj=_store.projects.find(p=>p.id===e.project_id);
            for (let i=0;i<5;i++){
                const d=new Date(ws);d.setDate(d.getDate()+i);
                if(d.getFullYear()!==year)continue;
                const ds=_fmtDate(d), hours=e[dayNames[i]];
                if(hours>0){if(!daysData[ds])daysData[ds]=[];daysData[ds].push({project_name:proj?proj.name:"?",project_id:e.project_id,hours});}
            }
        }
        const french=_getFrenchHolidays(year);
        const allHols={};
        const d=new Date(year,0,1);
        while(d.getFullYear()===year){
            const ds=_fmtDate(d);
            if(french[ds])allHols[ds]=french[ds];
            else{const ch=_store.custom_holidays.find(h=>h.date===ds);if(ch)allHols[ds]=ch.label;}
            d.setDate(d.getDate()+1);
        }
        const months=[];
        for(let mm=1;mm<=12;mm++){
            const md=new Date(year,mm-1,1),mld=new Date(year,mm,0);
            months.push({month:mm, first_weekday:md.getDay()===0?6:md.getDay()-1, num_days:mld.getDate()});
        }
        return {year, days:daysData, holidays:allHols, months};
    }

    // --- Unfilled weeks ---
    if (path === "/api/unfilled_weeks" && method === "GET") {
        const userId=+params.get("user_id");
        const year=new Date().getFullYear();
        let d=new Date(year,0,1);
        while(d.getDay()!==1)d.setDate(d.getDate()+1);
        const today=new Date();
        const end=today<new Date(year,11,31)?today:new Date(year,11,31);
        const endMon=_mondayOf(end);
        const unfilled=[];
        while(d<=endMon){
            const ws=_fmtDate(d);
            const hols=_getHolidaysForWeek(ws);
            const expected=35-Object.keys(hols).length*7;
            const total=_store.time_entries.filter(e=>e.user_id===userId&&e.week_start===ws)
                .reduce((s,e)=>s+e.monday+e.tuesday+e.wednesday+e.thursday+e.friday,0);
            if(expected>0&&Math.abs(total-expected)>0.01)unfilled.push(ws);
            d.setDate(d.getDate()+7);
        }
        return {unfilled};
    }

    // --- Year summary ---
    if (path === "/api/year_summary" && method === "GET") {
        const year=+params.get("year")||new Date().getFullYear();
        const users=[..._store.users].sort((a,b)=>a.name.localeCompare(b.name));
        let firstMon=new Date(year,0,1);
        while(firstMon.getDay()!==1)firstMon.setDate(firstMon.getDate()+1);
        const today=new Date(),endDate=today<new Date(year,11,31)?today:new Date(year,11,31);
        const endMon=_mondayOf(endDate);
        const weeks=[];
        const d=new Date(firstMon);
        while(d<=endMon){weeks.push(_fmtDate(d));d.setDate(d.getDate()+7);}
        const weekExp={};
        for(const ws of weeks){weekExp[ws]=35-Object.keys(_getHolidaysForWeek(ws)).length*7;}
        return {year, weeks, users:users.map(u=>{
            const uw={};let cc=0;
            for(const ws of weeks){
                const exp=weekExp[ws];
                const tot=_store.time_entries.filter(e=>e.user_id===u.id&&e.week_start===ws)
                    .reduce((s,e)=>s+e.monday+e.tuesday+e.wednesday+e.thursday+e.friday,0);
                const ok=exp<=0||Math.abs(tot-exp)<0.01;if(ok)cc++;
                uw[ws]={total:tot,expected:exp,complete:ok};
            }
            return {user:u,weeks:uw,complete_count:cc,total_weeks:weeks.length};
        })};
    }

    // --- Export ---
    if (path === "/api/export" && method === "GET")
        return {exported_at:new Date().toISOString(), ..._store};

    // --- Import ---
    if (path === "/api/import" && method === "POST") {
        _store = {
            users:body.users||[], projects:body.projects||[],
            time_entries:body.time_entries||[], custom_holidays:body.custom_holidays||[],
        };
        _nextId = {
            users:Math.max(0,..._store.users.map(r=>r.id))+1,
            projects:Math.max(0,..._store.projects.map(r=>r.id))+1,
            time_entries:Math.max(0,..._store.time_entries.map(r=>r.id))+1,
            custom_holidays:Math.max(0,..._store.custom_holidays.map(r=>r.id))+1,
        };
        _saveStore();
        return {ok:true, imported:{
            users:_store.users.length, projects:_store.projects.length,
            time_entries:_store.time_entries.length, custom_holidays:_store.custom_holidays.length,
        }};
    }

    console.warn("Unhandled API:", method, url);
    return {error:"Not found"};
}

// Export download helper
function exportData() {
    const data = {exported_at:new Date().toISOString(), ..._store};
    const blob = new Blob([JSON.stringify(data, null, 2)], {type:"application/json"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "cir_export.json";
    a.click();
    URL.revokeObjectURL(a.href);
}
