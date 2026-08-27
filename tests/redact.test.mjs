import test from 'node:test';
import assert from 'node:assert/strict';
import { redact, findSecretKinds } from '../lib/redact.mjs';

test('che AWS access key id', () => {
  const out = redact('aws key AKIAIOSFODNN7EXAMPLE done');
  assert.ok(!out.includes('AKIAIOSFODNN7EXAMPLE'));
  assert.ok(out.includes('AKIA***'));
});

test('che OpenAI-style key', () => {
  assert.ok(!redact('sk-abcdefghijklmnopqrstuvwxyz0123').includes('abcdefghij'));
});

test('che GitHub token', () => {
  assert.ok(!redact('ghp_abcdefghijklmnopqrstuvwxyz0123').includes('abcdefghij'));
});

test('che JWT', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123';
  assert.ok(!redact(`token ${jwt}`).includes('eyJzdWIi'));
});

test('che private key block', () => {
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----';
  assert.equal(redact(pem), '***private-key***');
});

test('không đụng text vô hại', () => {
  assert.equal(redact('psql -h localhost -U app'), 'psql -h localhost -U app');
});

test('findSecretKinds trả tên loại', () => {
  assert.deepEqual(findSecretKinds('AKIAIOSFODNN7EXAMPLE'), ['aws-access-key-id']);
  assert.deepEqual(findSecretKinds('không có gì'), []);
});

test('chuỗi rỗng hoặc null an toàn', () => {
  assert.equal(redact(''), '');
  assert.equal(redact(null), '');
});

test('che URL userinfo - postgresql', () => {
  const cmd = 'psql postgresql://admin:S3cr3tPw@db.prod:5432/app';
  assert.ok(!redact(cmd).includes('S3cr3tPw'));
  assert.ok(redact(cmd).includes('admin:***@'));
});

test('che password flag -p mysql', () => {
  const cmd = 'mysql -uroot -pMyP4ssw0rd app_db';
  assert.ok(!redact(cmd).includes('MyP4ssw0rd'));
  assert.ok(redact(cmd).includes('-p***'));
});

test('che env assignment AWS_SECRET_ACCESS_KEY', () => {
  const cmd = 'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCY aws s3 ls';
  assert.ok(!redact(cmd).includes('wJalrXUtnFEMI'));
  assert.ok(redact(cmd).includes('AWS_SECRET_ACCESS_KEY=***'));
});

test('che Authorization Bearer header', () => {
  const cmd = 'curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def" api';
  assert.ok(!redact(cmd).includes('eyJhbGciOiJIUzI1NiJ9'));
  assert.ok(redact(cmd).includes('Authorization: Bearer ***'));
});

test('findSecretKinds tìm multiple loại', () => {
  const cmd = 'AWS_SECRET_ACCESS_KEY=secret postgresql://user:pass@host ghp_abcdefghijklmnopqrst';
  const kinds = findSecretKinds(cmd);
  assert.ok(kinds.includes('env-sensitive'));
  assert.ok(kinds.includes('url-userinfo'));
  assert.ok(kinds.includes('github-token'));
});

test('LỘ: psql --password cách bằng space không được che', () => {
  const cmd = 'psql -h prod-db --password S3cr3tPw -U admin app';
  const out = redact(cmd);
  assert.ok(!out.includes('S3cr3tPw'), 'S3cr3tPw phải được che');
});

test('LỘ: mysqldump --password space không được che', () => {
  const cmd = 'mysqldump --password MyP4ssw0rd db';
  const out = redact(cmd);
  assert.ok(!out.includes('MyP4ssw0rd'), 'MyP4ssw0rd phải được che');
});

test('che-thừa: npm run build --production không thay đổi', () => {
  const cmd = 'npm run build --production';
  assert.equal(redact(cmd), cmd);
});

test('che-thừa: aws --profile không thay đổi', () => {
  const cmd = 'aws --profile prod s3 ls';
  assert.equal(redact(cmd), cmd);
});

test('che-thừa: git clone --progress không thay đổi', () => {
  const cmd = 'git clone --progress url';
  assert.equal(redact(cmd), cmd);
});

test('che: make -parallelism=5 (flag dài bị che do ambiguity)', () => {
  const cmd = 'make -parallelism=5';
  assert.ok(!redact(cmd).includes('parallelism'));
  assert.ok(redact(cmd).includes('-p***'));
});

test('findSecretKinds case-insensitive cho env variable', () => {
  assert.deepEqual(findSecretKinds('aws_secret_access_key=abc123'), ['env-sensitive']);
  assert.deepEqual(findSecretKinds('AWS_SECRET_ACCESS_KEY=abc123'), ['env-sensitive']);
});

test('che: mysql -psecret (lowercase)', () => {
  const cmd = 'mysql -psecret';
  assert.ok(!redact(cmd).includes('secret'));
  assert.ok(redact(cmd).includes('-p***'));
});

test('che: mysql -psecret123 với user', () => {
  const cmd = 'mysql -uroot -psecret123 db';
  assert.ok(!redact(cmd).includes('secret123'));
  assert.ok(redact(cmd).includes('-p***'));
});

test('che: mysql -p9pass (số đầu)', () => {
  const cmd = 'mysql -p9pass db';
  assert.ok(!redact(cmd).includes('9pass'));
  assert.ok(redact(cmd).includes('-p***'));
});

test('che: psql --password dạng flag rõ', () => {
  const cmd = 'psql -h prod-db --password S3cr3tPw -U admin app';
  assert.ok(!redact(cmd).includes('S3cr3tPw'));
  assert.ok(redact(cmd).includes('--password ***'));
});

test('che: mysqldump --password=pass dạng equals', () => {
  const cmd = 'mysqldump --password=P4ss99 db';
  assert.ok(!redact(cmd).includes('P4ss99'));
  assert.ok(redact(cmd).includes('--password=***'));
});

test('che: terraform -parallelism=5 (flag dài bị che do ambiguity)', () => {
  const cmd = 'terraform apply -parallelism=5';
  assert.ok(!redact(cmd).includes('parallelism'));
  assert.ok(redact(cmd).includes('-p***'));
});

test('che-thừa: terraform -var=foo không thay đổi', () => {
  const cmd = 'terraform apply -var=foo';
  assert.equal(redact(cmd), cmd);
});

test('che-thừa: aws --profile=prod không thay đổi', () => {
  const cmd = 'aws --profile=prod s3 ls';
  assert.equal(redact(cmd), cmd);
});

test('che-thừa: psql -p 5432 (cổng) không thay đổi', () => {
  const cmd = 'psql -p 5432 -h db -l';
  assert.equal(redact(cmd), cmd);
});

// --- Round 4: giá trị -p trong quote (lỗ hổng mà 3 round trước để hở) ---
// Bug cũ: /-p([^\s=]+)/ dừng ở khoảng trắng đầu tiên, nên chỉ '-p'my bị nuốt,
// phần còn lại của giá trị trong quote in nguyên văn ra output.

test('che: mysql -p\'my pass\' db (single quote chứa khoảng trắng)', () => {
  const cmd = "mysql -p'my pass' db";
  const out = redact(cmd);
  assert.ok(!out.includes('my pass'), 'giá trị trong quote không được lộ');
  assert.ok(!out.includes("pass'"), 'phần đuôi sau khoảng trắng không được lộ trần');
  assert.equal(out, 'mysql -p*** db');
});

test('che: mysql -p"my pass" db (double quote chứa khoảng trắng)', () => {
  const cmd = 'mysql -p"my pass" db';
  const out = redact(cmd);
  assert.ok(!out.includes('my pass'), 'giá trị trong quote không được lộ');
  assert.ok(!out.includes('pass"'), 'phần đuôi sau khoảng trắng không được lộ trần');
  assert.equal(out, 'mysql -p*** db');
});

test('che: mysql -p\'secret\' db (single quote không khoảng trắng)', () => {
  const cmd = "mysql -p'secret' db";
  const out = redact(cmd);
  assert.ok(!out.includes('secret'));
  assert.equal(out, 'mysql -p*** db');
});

test('che: mysql -pYWJjZA== db (base64, padding == lộ được chấp nhận)', () => {
  const cmd = 'mysql -pYWJjZA== db';
  const out = redact(cmd);
  assert.ok(!out.includes('YWJjZA'), 'thân base64 phải được che');
});

test('che: cả hai -p khi nối lệnh bằng &&', () => {
  const cmd = 'mysql -pa1 && psql -pb2';
  const out = redact(cmd);
  assert.ok(!out.includes('a1'));
  assert.ok(!out.includes('b2'));
});

test('che: URL userinfo postgresql với password khác', () => {
  const cmd = 'psql postgresql://admin:UrlPw1@db:5432/app';
  const out = redact(cmd);
  assert.ok(!out.includes('UrlPw1'));
});

test('che: env variable chữ thường qua redact() (không chỉ findSecretKinds)', () => {
  const cmd = 'aws_secret_access_key=wJalrXUtnFEMI aws s3 ls';
  const out = redact(cmd);
  assert.ok(!out.includes('wJalrXUtnFEMI'));
});

test('che: Authorization Basic header', () => {
  const cmd = 'curl -H "Authorization: Basic dXNlcjpwYXNz"';
  const out = redact(cmd);
  assert.ok(!out.includes('dXNlcjpwYXNz'));
  assert.ok(out.includes('Authorization: Basic ***'));
});

test('che: export DB_PASSWORD=hunter2 && ./run', () => {
  const cmd = 'export DB_PASSWORD=hunter2 && ./run';
  const out = redact(cmd);
  assert.ok(!out.includes('hunter2'));
  assert.ok(out.includes('DB_PASSWORD=***'));
});

test('giữ nguyên: git push origin main', () => {
  const cmd = 'git push origin main';
  assert.equal(redact(cmd), cmd);
});

test('giữ nguyên: ls -la /etc/passwd', () => {
  const cmd = 'ls -la /etc/passwd';
  assert.equal(redact(cmd), cmd);
});

test('giữ nguyên: foo-psecret (giữa từ, không phải flag)', () => {
  const cmd = 'foo-psecret';
  assert.equal(redact(cmd), cmd);
});

test('không mask sai: mysql -p (cuối chuỗi, không giá trị)', () => {
  const cmd = 'mysql -p';
  assert.equal(redact(cmd), cmd);
});

// --- Round 4 bonus: --password= và --password<space> có lỗ quote y hệt -p,
// chưa từng bị đo tới. Sửa đồng bộ trong cùng lần này vì cùng file, cùng lớp bug.

test('che: --password value trong single quote chứa khoảng trắng', () => {
  const cmd = "psql -h h --password 'S3cr3t Pw' -U a";
  const out = redact(cmd);
  assert.ok(!out.includes('S3cr3t Pw'));
  assert.ok(!out.includes("Pw'"), "phần đuôi sau khoảng trắng không được lộ trần");
  assert.equal(out, 'psql -h h --password *** -U a');
});

test('che: --password=value trong double quote chứa khoảng trắng', () => {
  const cmd = 'mysqldump --password="P4ss 99" db';
  const out = redact(cmd);
  assert.ok(!out.includes('P4ss 99'));
  assert.ok(!out.includes('99"'), "phần đuôi sau khoảng trắng không được lộ trần");
  assert.equal(out, 'mysqldump --password=*** db');
});

// --- Round 5: ba ranh giới coordinator đo được (đóng cả ba theo phán quyết) ---
// (1) env-sensitive và auth-header dùng chung idiom [^\s]+ với -p/--password —
//     cùng lớp lỗi, chưa từng được quote-aware hoá.
// (2) Quote mở nhưng không đóng: round 4 rơi xuống nhánh cũ, lộ phần đuôi.
//     Round 5: che tới hết chuỗi thay vì rơi xuống nhánh cũ.

test('che: export DB_PASSWORD trong single quote chứa khoảng trắng (đo bởi coordinator)', () => {
  const cmd = "export DB_PASSWORD='hunter two' && x";
  const out = redact(cmd);
  assert.ok(!out.includes('hunter two'));
  assert.ok(!out.includes("two'"), 'phần đuôi sau khoảng trắng không được lộ trần');
  assert.equal(out, 'export DB_PASSWORD=*** && x');
});

test('che: Authorization Bearer nguyên header trong quote (đo bởi coordinator)', () => {
  const cmd = "curl -H 'Authorization: Bearer a b c'";
  const out = redact(cmd);
  assert.ok(!out.includes('a b c'));
  assert.ok(!out.includes(' b c'), 'phần đuôi sau khoảng trắng đầu không được lộ trần');
  assert.ok(out.includes('Authorization: Bearer ***'));
});

test('che: mysql -p với quote không đóng — che tới hết chuỗi (đo bởi coordinator)', () => {
  const cmd = "mysql -p'chua dong";
  const out = redact(cmd);
  assert.ok(!out.includes('chua dong'));
  assert.ok(!out.includes('dong'), 'không được rơi xuống nhánh cũ và lộ phần đuôi');
  assert.equal(out, 'mysql -p***');
});

// --- Round 5: quote không đóng cho các pattern còn lại (nhất quán cùng idiom) ---

test('che: --password=value với quote không đóng — che tới hết chuỗi', () => {
  const cmd = "mysqldump --password='chua dong db";
  const out = redact(cmd);
  assert.ok(!out.includes('chua dong'));
  assert.equal(out, 'mysqldump --password=***');
});

test('che: --password value (space) với quote không đóng — che tới hết chuỗi', () => {
  const cmd = "psql --password 'chua dong -U a";
  const out = redact(cmd);
  assert.ok(!out.includes('chua dong'));
  assert.equal(out, 'psql --password ***');
});

test('che: env var với quote không đóng — che tới hết chuỗi', () => {
  const cmd = "export DB_PASSWORD='chua dong";
  const out = redact(cmd);
  assert.ok(!out.includes('chua dong'));
  assert.equal(out, 'export DB_PASSWORD=***');
});

// --- Round 5: đảm bảo auth-header-quoted không nuốt nội dung không liên quan ---

test('che: Authorization trong quote không nuốt flag phía sau (-d JSON)', () => {
  const cmd = `curl -H "Authorization: Bearer TOK" -d '{"a":1}' url`;
  const out = redact(cmd);
  assert.ok(!out.includes('TOK'));
  assert.ok(out.includes(`-d '{"a":1}' url`), 'nội dung -d không liên quan phải giữ nguyên');
});

test('che: Authorization không có quote bao quanh vẫn được che (nhánh bare)', () => {
  const cmd = 'curl -H Authorization:Bearer abc123 -X POST';
  const out = redact(cmd);
  assert.ok(!out.includes('abc123'));
});
