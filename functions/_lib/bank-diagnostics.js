// Strict allowlists only. Never accept provider text, request bodies or headers.
const stages = new Set(['validation','authorization','accounts','encryption','save','complete','transactions']);
const oauthCodes = new Set(['invalid_grant','invalid_client','unauthorized_client','invalid_request','unsupported_grant_type','invalid_scope','access_denied','temporarily_unavailable','server_error']);
const codes = new Set(('bank_unavailable bank_auth bank_rate_limit bank_response_large bank_schema bank_not_configured bank_operation_forbidden bank_server_setup bank_credentials_unavailable bank_connection_input bank_date_range bank_no_accounts bank_busy bank_input bank_owner_only bank_origin bank_login_rejected bank_client_rejected bank_auth_request bank_auth_unavailable bank_accounts_unavailable bank_transactions_unavailable bank_timeout bank_network bank_save_failed bank_encryption_failed').split(' '));
export const safeBankCode = code => codes.has(code) ? code : 'bank_unavailable';
codes.add('bank_redirect');
export function safeBankDiagnostic(value={}) {
  return {
    stage: stages.has(value.stage) ? value.stage : 'validation',
    upstream_status: Number.isInteger(value.upstream_status) && value.upstream_status>=100 && value.upstream_status<=599 ? value.upstream_status : null,
    oauth_code: oauthCodes.has(value.oauth_code) ? value.oauth_code : null,
  };
}
function safeRecord(value={}) {
  return {id:/^[a-f0-9-]{36}$/.test(value.id)?value.id:null,
    at:/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value.at)?value.at:null,
    ...safeBankDiagnostic(value),outcome:value.outcome==='ok'?'ok':'error',
    code:value.outcome==='ok'?null:safeBankCode(value.code),
    elapsed_ms:Number.isFinite(value.elapsed_ms)?Math.min(300000,Math.max(0,Math.round(value.elapsed_ms))):0};
}
export async function saveConnectDiagnostic(env, value) {
  const diagnostic=safeRecord({...value,id:crypto.randomUUID(),at:new Date().toISOString()});
  try {
    // Existing table; never log DB errors, which may include bindings.
    await env.DB.prepare(`INSERT INTO admin_audit_log(id,created_at,actor,action,entity_type,entity_id,details_json)
      VALUES(?,?,'owner','bank.connect_diagnostic','bank_connection','pumb',?)`)
      .bind(diagnostic.id,diagnostic.at,JSON.stringify(diagnostic)).run();
    return {...diagnostic,saved:true};
  } catch { return {...diagnostic,saved:false}; }
}
export async function lastConnectDiagnostic(env) {
  try {
    const row=await env.DB.prepare("SELECT details_json FROM admin_audit_log WHERE action='bank.connect_diagnostic' AND entity_type='bank_connection' AND entity_id='pumb' ORDER BY created_at DESC,id DESC LIMIT 1").first();
    return row ? safeRecord(JSON.parse(row.details_json)) : null;
  } catch { return null; }
}
