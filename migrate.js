const admin = require('firebase-admin');
const fs = require('fs');

// サービスアカウントキー (Firebaseコンソールから取得して配置)
// ※ファイル名は .gitignore に追加すること
const SERVICE_ACCOUNT_PATH = './serviceAccountKey.json';
const DATA_FILE = './gas_backup.json';

// チェック
if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.error(`Service account key not found: ${SERVICE_ACCOUNT_PATH}`);
    console.error('Please place your serviceAccountKey.json in the project root.');
    process.exit(1);
}

const serviceAccount = require(SERVICE_ACCOUNT_PATH);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function migrate() {
    if (!fs.existsSync(DATA_FILE)) {
        console.error(`Data file not found: ${DATA_FILE}`);
        console.error('Please place your gas_backup.json in the project root.');
        return;
    }

    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const members = raw.data || {};
    const officeId = 'nagoya_chuo'; // 移行先オフィスID

    console.log(`Migrating ${Object.keys(members).length} members to office: ${officeId}...`);

    const batch = db.batch();
    let count = 0;
    let batchCount = 0;
    const BATCH_SIZE = 400; // API limit is 500

    for (const [userId, val] of Object.entries(members)) {
        // メンバーIDとしてuserIdを使用、あるいはval.idがあればそれを使う（現状はuserIdがキー）
        const docId = userId;
        const docRef = db.collection('offices').doc(officeId).collection('members').doc(docId);

        batch.set(docRef, {
            name: String(val.name || ''),
            group: String(val.group || ''), // group info might be needed if structure changed
            order: val.order ? Number(val.order) : 0,
            status: String(val.status || ''),
            time: String(val.time || ''),
            note: String(val.note || ''),
            workHours: String(val.workHours || ''),
            // 既存の他のフィールドも必要に応じて移行
            mobile: String(val.mobile || ''),
            ext: String(val.ext || ''),
            email: String(val.email || ''),

            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        count++;
        batchCount++;
        if (batchCount >= BATCH_SIZE) {
            await batch.commit();
            console.log(`Committed ${count} records...`);
            // 新しいバッチを開始
            // batchは大文字小文字区別再初期化が必要？いいえ、batchは1回commitしたら終わりなので再取得必要
            // しかしforループ内で再定義できないので、ループ外で変数定義して再取得する構造にする必要があるが
            // ここでは batch 変数は再利用できないため、単純にループを複雑にするより
            // チャンクに分けて処理するか、batch変数を再代入できるようにする
        }
    }

    // NOTE: Simple batch restart logic is hard in single loop without reassignment support or chunking.
    // Rewriting to use chunking explicitly for safety.
}

async function migrateSafe() {
    if (!fs.existsSync(DATA_FILE)) {
        console.error(`Data file not found: ${DATA_FILE}`);
        return;
    }

    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    // データ構造が { "data": { ... } } なのか { "sheetName": [ ... ] } なのか確認が必要
    // JSスニペットによると { "data": { "user1": ... } }
    const members = raw.data || {};
    const officeId = 'nagoya';

    const entries = Object.entries(members);
    console.log(`Migrating ${entries.length} members to office: ${officeId}...`);

    // 400件ずつ分割
    const chunkSize = 400;
    for (let i = 0; i < entries.length; i += chunkSize) {
        const chunk = entries.slice(i, i + chunkSize);
        const batch = db.batch();

        for (const [userId, val] of chunk) {
            const docRef = db.collection('offices').doc(officeId).collection('members').doc(userId);
            batch.set(docRef, {
                status: String(val.status || ''),
                time: String(val.time || ''),
                note: String(val.note || ''),
                workHours: String(val.workHours || ''),
                // 追加: 必須フィールドを補完
                name: String(val.name || ''),
                // updatedAt
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        }

        await batch.commit();
        console.log(`Committed ${Math.min(i + chunkSize, entries.length)} / ${entries.length} records...`);
    }

    console.log('Migration completed!');
}

migrateSafe().catch(console.error);
