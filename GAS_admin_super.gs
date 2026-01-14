// admin_super.gs
// 実行する関数: SET_SUPER_PASSWORD_ONCE()

// ※ 他ファイルとの定数衝突を避けるため、ここでは独自名の定数にしています。
//    ただし実際に保存するプロパティ名（文字列）は本体と同一です。
const ADMIN_SUPER_PROP_SALT   = 'presence:SUPER_SALT';
const ADMIN_SUPER_PROP_KEYB64 = 'presence:SUPER_KEY_B64';

/**
 * スーパー管理者パスワードを新規設定／全更新（salt もローテーション）
 * 手順:
 *  1) NEW_PLAIN を希望の新パスワードに書き換え
 *  2) この関数を1回実行
 *  3) ログに "OK:" が出たら完了（Webアプリの再デプロイは不要）
 */
function SET_SUPER_PASSWORD_ONCE() {
  const NEW_PLAIN = 'iwCzWDMhY8SU'; // ← 必ず変更
  if (!NEW_PLAIN) throw new Error('Empty password');

  const p = PropertiesService.getScriptProperties();

  // 新しい salt を生成（Base64）
  const saltBytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    Utilities.newBlob(Utilities.getUuid()).getBytes()
  );
  const saltB64 = Utilities.base64Encode(saltBytes);

  // key = SHA256( salt(Base64文字列のまま) + NEW_PLAIN ) を Base64 で保存
  const keyBytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    Utilities.newBlob(saltB64 + NEW_PLAIN).getBytes()
  );
  const keyB64 = Utilities.base64Encode(keyBytes);

  p.setProperty(ADMIN_SUPER_PROP_SALT,   saltB64);
  p.setProperty(ADMIN_SUPER_PROP_KEYB64, keyB64);

  Logger.log('OK: super password rotated. salt=%s', saltB64);
}

/**
 * （任意）salt を変えずにパスワードだけ差し替える版
 *  既存 salt を残したい場合はこちらを実行
 */
function SET_SUPER_PASSWORD_KEEP_SALT() {
  const NEW_PLAIN = 'iwCzWDMhY8SU'; // ← 必ず変更
  if (!NEW_PLAIN) throw new Error('Empty password');

  const p = PropertiesService.getScriptProperties();
  const saltB64 = p.getProperty(ADMIN_SUPER_PROP_SALT);
  if (!saltB64) throw new Error('No salt exists. Run SET_SUPER_PASSWORD_ONCE first.');

  const keyBytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    Utilities.newBlob(saltB64 + NEW_PLAIN).getBytes()
  );
  const keyB64 = Utilities.base64Encode(keyBytes);

  p.setProperty(ADMIN_SUPER_PROP_KEYB64, keyB64);
  Logger.log('OK: super password updated with existing salt.');
}
