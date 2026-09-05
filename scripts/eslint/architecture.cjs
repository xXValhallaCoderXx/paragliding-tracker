const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const appPath = (filename) => path.relative(root, filename).replaceAll('\\', '/').replace(/\.(native|web)?\.?[cm]?[jt]sx?$/, '');
function destination(specifier, filename) {
  if (specifier.startsWith('@/')) return `src/${specifier.slice(2)}`;
  if (specifier.startsWith('.')) return appPath(path.resolve(path.dirname(filename), specifier));
  return specifier;
}
const typeOnly = (node) => node.importKind === 'type' || node.exportKind === 'type' ||
  (node.specifiers?.length > 0 && node.specifiers.every((s) => s.importKind === 'type' || s.exportKind === 'type'));

module.exports = {
  meta: { type: 'problem', schema: [], messages: {
    boundary: '{{from}} must not load {{target}} at runtime ({{reason}}).',
    unsupported: 'AbortSignal.{{method}} is unavailable in the installed native abort-controller; use the local timeout helper.',
    captureSql: 'Cloud bookkeeping must not write recorder evidence tables.',
    staticImport: 'Use a literal module path so architecture boundaries can be checked.',
  } },
  create(context) {
    const from = appPath(context.filename);
    const layer = from.split('/')[1];
    function check(node, value) {
      if (typeof value !== 'string') return;
      const target = destination(value, context.filename);
      const targetLayer = target.startsWith('src/') ? target.split('/')[1] : null;
      let reason;
      if (layer === 'recorder' && ((targetLayer && !['recorder', 'lib'].includes(targetLayer)) || target.startsWith('@supabase/'))) reason = 'capture isolation';
      if (layer === 'lib' && ((targetLayer && targetLayer !== 'lib') || target.startsWith('@supabase/'))) reason = 'shared helpers remain leaves';
      if (/^src\/lib\/(track|replay)\//.test(from) && /^(react|react-native|react-native-svg)(\/|$)/.test(target)) reason = 'geometry is renderer independent';
      if (['cloud', 'store'].includes(layer) && ['app', 'features', 'components'].includes(targetLayer)) reason = 'services cannot load UI';
      if (layer === 'store' && /^src\/(recorder\/recorder-service|cloud\/(auth-service|sync-engine|supabase))/.test(target)) reason = 'store construction cannot subscribe to services';
      if (layer === 'sites' && targetLayer && targetLayer !== 'sites') reason = 'catalogue clients remain independent';
      if (['app', 'features', 'components'].includes(layer) && /^src\/recorder\/(flight-repository|database)/.test(target)) reason = 'UI data access goes through the cache';
      if (reason) context.report({ node, messageId: 'boundary', data: { from, target, reason } });
    }
    function importOrExport(node) { if (!typeOnly(node)) check(node, node.source?.value); }
    function sql(node, value) {
      if (from === 'src/recorder/sync-repository-core' && /\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE|DELETE\s+FROM)\s+(?:sessions|location_fixes|pressure_samples|events|exports|session_recovery_attempts)\b/i.test(value)) {
        context.report({ node, messageId: 'captureSql' });
      }
    }
    return {
      ImportDeclaration: importOrExport, ExportNamedDeclaration: importOrExport, ExportAllDeclaration: importOrExport,
      ImportExpression(node) {
        const value = node.source.value ?? (node.source.expressions?.length === 0 ? node.source.quasis[0].value.cooked : undefined);
        if (typeof value !== 'string') context.report({ node, messageId: 'staticImport' });
        else check(node, value);
      },
      CallExpression(node) { if (node.callee.type === 'Identifier' && node.callee.name === 'require') check(node, node.arguments[0]?.value); },
      MemberExpression(node) {
        const name = node.computed ? node.property.value : node.property.name;
        if (node.object.type === 'Identifier' && node.object.name === 'AbortSignal' && ['timeout', 'any'].includes(name)) {
          context.report({ node, messageId: 'unsupported', data: { method: name } });
        }
      },
      Literal(node) { if (typeof node.value === 'string') sql(node, node.value); },
      TemplateLiteral(node) { sql(node, node.quasis.map((part) => part.value.cooked).join(' ')); },
    };
  },
};
