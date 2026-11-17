require("dotenv/config");
const express = require("express");
const multer = require("multer");
const Database = require("better-sqlite3");
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const dbDir = path.join(__dirname, "data");
const imageDir = path.join(__dirname, "uploads");
fs.mkdirSync(dbDir, {recursive:true});
fs.mkdirSync(imageDir, {recursive:true});

const db = new Database(path.join(dbDir, "jantex.sqlite"));
db.exec(`CREATE TABLE IF NOT EXISTS records (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 register_date TEXT, lot_number TEXT, lot_name TEXT, quality TEXT,
 total_colors TEXT, report_date TEXT, received_colors TEXT,
 image_path TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`);
app.use(express.json({limit:"15mb"}));
app.use(express.static(path.join(__dirname,"public")));
app.use("/uploads", express.static(imageDir));
const upload = multer({storage:multer.memoryStorage(), limits:{fileSize:12*1024*1024}});

app.post("/api/extract", upload.single("image"), async (req,res)=>{
  try {
    if (!req.file) return res.status(400).json({error:"تصویر موصول نہیں ہوئی۔"});
    if (!process.env.OPENAI_API_KEY) return res.status(503).json({error:"AI API Key ابھی سیٹ نہیں کی گئی۔ .env فائل میں OPENAI_API_KEY درج کریں۔"});
    const mime = req.file.mimetype || "image/jpeg";
    const dataUrl = `data:${mime};base64,${req.file.buffer.toString("base64")}`;
    const prompt = `Read this textile lab register image carefully. Return ONLY valid JSON with exactly these keys: register_date, lot_number, lot_name, quality, total_colors, report_date, received_colors. Preserve the written values exactly. If a field is unclear or absent, use an empty string. Do not guess. Dates should be DD-MM-YYYY when readable.`;
    const r = await fetch("https://api.openai.com/v1/responses", {
      method:"POST",
      headers:{"Authorization":`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},
      body:JSON.stringify({model:process.env.OPENAI_MODEL || "gpt-4.1-mini",input:[{role:"user",content:[{type:"input_text",text:prompt},{type:"input_image",image_url:dataUrl}]}]})
    });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error?.message || "AI سروس سے جواب نہیں ملا۔");
    let output = body.output_text || "";
    if (!output) {
      for (const item of (body.output||[])) for (const c of (item.content||[])) if (c.text) output += c.text;
    }
    output = output.replace(/```json|```/g,"").trim();
    const parsed = JSON.parse(output);
    res.json({data:parsed});
  } catch(e) { res.status(500).json({error:"ڈیٹا پڑھنے میں مسئلہ: "+e.message}); }
});

app.post("/api/records", (req,res)=>{
  try {
    const d=req.body || {};
    const required=["register_date","lot_number","lot_name","quality","total_colors","report_date","received_colors"];
    if (!d.lot_number) return res.status(400).json({error:"Lot Number لازمی ہے۔"});
    let imagePath="";
    if (d.image_data) {
      const match=d.image_data.match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/);
      if (!match) return res.status(400).json({error:"تصویر کا فارمیٹ درست نہیں۔"});
      const ext=match[1]==="jpeg"?"jpg":match[1];
      const name=`${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      fs.writeFileSync(path.join(imageDir,name),Buffer.from(match[2],"base64"));
      imagePath="/uploads/"+name;
    }
    const stmt=db.prepare(`INSERT INTO records (${required.join(",")},image_path) VALUES (@register_date,@lot_number,@lot_name,@quality,@total_colors,@report_date,@received_colors,@image_path)`);
    const info=stmt.run({...d,image_path:imagePath});
    res.json({success:true,id:info.lastInsertRowid});
  } catch(e){res.status(500).json({error:e.message});}
});

app.get("/api/records",(req,res)=>{
 const q=(req.query.q||"").trim();
 const rows=q ? db.prepare(`SELECT * FROM records WHERE lot_number LIKE ? OR lot_name LIKE ? OR register_date LIKE ? ORDER BY id DESC`).all(`%${q}%`,`%${q}%`,`%${q}%`)
 : db.prepare("SELECT * FROM records ORDER BY id DESC").all();
 res.json(rows);
});

app.get("/api/master.xlsx",(req,res)=>{
 const rows=db.prepare("SELECT register_date AS 'Register Date', lot_number AS 'Lot Number', lot_name AS 'Lot Name', quality AS 'Quality', total_colors AS 'Total Colors', report_date AS 'Report Date', received_colors AS 'Received Colors', image_path AS 'Image' FROM records ORDER BY id ASC").all();
 const wb=XLSX.utils.book_new();
 const ws=XLSX.utils.json_to_sheet(rows);
 XLSX.utils.book_append_sheet(wb,ws,"JANTEX Records");
 const buffer=XLSX.write(wb,{type:"buffer",bookType:"xlsx"});
 res.setHeader("Content-Disposition",'attachment; filename="JANTEX_MASTER_RECORDS.xlsx"');
 res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").send(buffer);
});

app.listen(PORT,()=>console.log(`JANTEX REGISTER SCANNER running on port ${PORT}`));
