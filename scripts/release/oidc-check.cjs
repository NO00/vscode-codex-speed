/** 复用锁定 VSCE 的官方交换实现，仅验证策略；短期凭证不写文件也不打印。 */
async function main() {
  if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('可信发布验证需要在 GitHub Actions 中运行');
  const { getOIDCCredential } = require('@vscode/vsce/out/oidc');
  const credential = await getOIDCCredential('NO00');
  if (typeof credential !== 'string' || !credential) throw new Error('Marketplace 未返回有效的短期发布凭证');
  console.log('GitHub OIDC → Marketplace 凭证交换成功。未发布插件，未保存或输出凭证。');
}

main().catch(error => {
  // 官方接口的错误文本包含状态及失败阶段，不展开请求对象或认证头。
  console.error(`OIDC 验证失败：${error.message}`);
  process.exitCode = 1;
});
