const admin = require('firebase-admin');
const fs = require('fs');

// サービスアカウントキー
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// 読み込むCSVファイル名
const CSV_FILE = './members.csv';
// 移行先のオフィスID
const OFFICE_ID = 'nagoya_chuo';

async function migrateFromCSV() {
    if (!fs.existsSync(CSV_FILE)) {
        console.error(`CSV file not found: ${CSV_FILE}`);
        return;
    }

    console.log(`Reading CSV file: ${CSV_FILE}...`);
    const content = fs.readFileSync(CSV_FILE, 'utf8');

    // CSVを行に分割 (改行コード対応)
    const lines = content.split(/\r?\n/).filter(line => line.trim() !== '');

    // ヘッダー行を探して、データ開始行を特定する
    // マニュアルによると:
    // 1行目: "在席管理CSV" (無い場合もある)
    // 2行目: ヘッダー (グループ番号,グループ名,表示順,id,氏名...)
    let dataStartIndex = 0;

    // ヘッダー行("id"や"氏名"が含まれる行)を探す
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('氏名') && lines[i].includes('id')) {
            dataStartIndex = i + 1; // その次の行からデータ
            break;
        }
    }

    console.log(`Starting migration to office: ${OFFICE_ID}...`);
    const batch = db.batch();
    let count = 0;

    // データ行をループ
    for (let i = dataStartIndex; i < lines.length; i++) {
        const line = lines[i];
        const cols = parseCSVLine(line);

        // カラム数が足りない行はスキップ
        if (cols.length < 5) continue;

        // CSVの列定義 (マニュアル準拠)
        // 0:グループ番号, 1:グループ名, 2:表示順, 3:id, 4:氏名, 5:内線, 6:携帯, 7:Email, 8:業務時間, 9:ステータス, 10:戻り時間, 11:備考
        // ※ 古い形式のCSVの場合、列がずれる可能性がありますが、idと氏名は必須

        const id = cols[3] ? cols[3].trim() : '';
        const name = cols[4] ? cols[4].trim() : '';

        if (!id || !name) continue; // IDか名前が無い行は無視

        const docRef = db.collection('offices').doc(OFFICE_ID).collection('members').doc(id);

        batch.set(docRef, {
            name: name,
            group: cols[1] || '',
            order: Number(cols[2]) || (i * 10), // 表示順
            ext: cols[5] || '',
            mobile: cols[6] || '',
            email: cols[7] || '',
            workHours: cols[8] || '',
            status: cols[9] || '',
            time: cols[10] || '',
            note: cols[11] || '',
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        count++;
    }

    if (count > 0) {
        await batch.commit();
        console.log(`Successfully migrated ${count} members!`);
    } else {
        console.log('No valid members found in CSV.');
    }
}

// 簡易CSVパーサー (カンマ区切り、ダブルクォート対応)
function parseCSVLine(text) {
    const res = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuote) {
            if (c === '"') {
                if (i + 1 < text.length && text[i + 1] === '"') {
                    cur += '"'; i++;
                } else {
                    inQuote = false;
                }
            } else {
                cur += c;
            }
        } else {
            if (c === '"') {
                inQuote = true;
            } else if (c === ',') {
                res.push(cur); cur = '';
            } else {
                cur += c;
            }
        }
    }
    res.push(cur);
    return res;
}

migrateFromCSV().catch(console.error);