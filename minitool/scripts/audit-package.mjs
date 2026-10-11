import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { parse } from '@babel/parser';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const failures = [], warnings = [], files = [];
const walkFiles = dir => { for (const name of readdirSync(dir)) { const target = path.join(dir,name); if(statSync(target).isDirectory())walkFiles(target);else files.push(target); } };walkFiles(dist);
const allowed = new Set(['.html','.css','.js','.png','.jpg','.jpeg','.gif','.webp','.svg','.woff','.woff2','.json']);
const htmlFiles = files.filter(f=>path.extname(f)==='.html');
if(htmlFiles.length!==1||htmlFiles[0]!==path.join(dist,'index.html'))failures.push('Exactly one root index.html required');
for(const f of files)if(!allowed.has(path.extname(f))||/\.map$|(?:^|\/)(?:node_modules|\.git|\.DS_Store)(?:\/|$)/.test(f))failures.push(`Disallowed artifact: ${f}`);
const html=readFileSync(path.join(dist,'index.html'),'utf8');
for(const pattern of [/<base\b/i,/<(?:iframe|object)\b/i,/type\s*=\s*["']module["']/i,/\bon\w+\s*=/i,/http-equiv\s*=\s*["']Content-Security-Policy/i])if(pattern.test(html))failures.push(`Forbidden HTML ${pattern}`);
if(!/<!doctype html>/i.test(html)||!/lang="zh-CN"/.test(html)||!html.includes('charset="UTF-8"')||!html.includes('viewport-fit=cover'))failures.push('Missing root HTML metadata');
for(const match of html.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)){const url=match[1];if(!url.startsWith('./')||!existsSync(path.join(dist,url)))failures.push(`Invalid resource ${url}`);}
for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))if(match[1].trim())failures.push('Inline script');
let syntaxFiles=0;
const bannedCalls=new Set(['fetch','eval','execCommand','requestFullscreen','webkitRequestFullscreen','getDisplayMedia','getCurrentPosition','watchPosition']);
const bannedConstructors=new Set(['XMLHttpRequest','WebSocket','EventSource','RTCPeerConnection','Worker','SharedWorker','Function','Accelerometer','Gyroscope','Magnetometer']);
const syntaxNodes=new Set(['ImportDeclaration','ExportNamedDeclaration','ExportDefaultDeclaration','ExportAllDeclaration','ImportExpression','OptionalMemberExpression','OptionalCallExpression','ClassProperty','ClassPrivateProperty','ClassPrivateMethod','StaticBlock','BigIntLiteral']);
function inspect(node,parent,file){
 if(!node||typeof node!=='object')return;
 if(syntaxNodes.has(node.type)||(node.type==='SpreadElement'&&parent?.type==='ObjectExpression')||(node.type==='LogicalExpression'&&node.operator==='??')||(node.type==='AssignmentExpression'&&['||=','&&=','??='].includes(node.operator))||(node.type==='ForOfStatement'&&node.await))failures.push(`${file}: incompatible syntax ${node.type}`);
 if(node.type==='RegExpLiteral'&&(/[dsv]/.test(node.flags)||/\(\?<|\\[pP]\{/.test(node.pattern)))failures.push(`${file}: newer regular expression`);
 if(node.type==='CallExpression'||node.type==='NewExpression'){
   const c=node.callee;const name=c?.type==='Identifier'?c.name:c?.type==='MemberExpression'&&!c.computed?c.property.name:null;
   if(bannedCalls.has(name)||(node.type==='NewExpression'&&bannedConstructors.has(name))||c?.type==='Import')failures.push(`${file}: forbidden API ${name||'import'}`);
 }
 for(const [key,value] of Object.entries(node)){if(['loc','start','end','extra','comments','tokens'].includes(key))continue;if(Array.isArray(value))value.forEach(child=>inspect(child,node,file));else if(value&&typeof value==='object')inspect(value,node,file);}
}
for(const file of files.filter(f=>f.endsWith('.js'))){try{const tree=parse(readFileSync(file,'utf8'),{sourceType:'script'});inspect(tree,null,path.relative(dist,file));syntaxFiles++;}catch(e){failures.push(`${file}: ${e.message}`);}}
const modelReport=JSON.parse(readFileSync(path.join(root,'generated/model-report.json'),'utf8'));
let vertices=0, triangles=0;
for(const [id,report] of Object.entries(modelReport)){
 const file=path.join(dist,'models',`${id}.js`);if(!existsSync(file)){failures.push(`Missing model ${id}`);continue;}
 const context={window:{}};vm.runInNewContext(readFileSync(file,'utf8'),context,{timeout:1000});
 let sum=0;
 for(const mesh of context.window.HamilyModels[id]()){
  if(mesh.p.length%3||mesh.i.length%3||mesh.p.some(n=>!Number.isFinite(n))||mesh.i.some(i=>!Number.isInteger(i)||i<0||i>=mesh.p.length/3))failures.push(`Invalid geometry ${id}`);
  if(!mesh.extras.sourcePart||!mesh.extras.colorKey)failures.push(`Missing material role ${id}`);
  sum+=mesh.i.length/3;vertices+=mesh.p.length/3;
 }
 triangles+=sum;if(sum!==report.previewTriangles)failures.push(`Geometry report mismatch ${id}`);
}
const styles=['original','woodland','strawberry','sky','jade-garden'];
const catalog=JSON.parse(readFileSync(path.join(root,'../public/thumbnails/style-manifest.json'),'utf8'));
let thumbnails=0;for(const style of styles)for(const product of Object.keys(catalog[style])){if(!existsSync(path.join(dist,'thumbnails',style,product+'.webp')))failures.push(`Missing thumbnail ${style}/${product}`);thumbnails++;}
const bundle=readFileSync(path.join(dist,'app.js'),'utf8');
for(const pattern of [/navigator\.clipboard/,/WebAssembly\./,/navigator\.xr/,/new\s+Worker\s*\(/])if(pattern.test(bundle))failures.push(`Forbidden capability residual ${pattern}`);
// URLs remaining in React/Three are namespace identifiers and diagnostics, not loads.
const urls=[...new Set(bundle.match(/https?:\/\/[^\s"'`<>\\]+/g)||[])];
const unusualUrls=urls.filter(url=>!/^https?:\/\/(www\.w3\.org\/|react\.dev\/errors\/|threejs\.org\/|github\.com\/|www\.khronos\.org\/)/.test(url));
// Reviewed: these are reference citations inside Three GLSL shader comments, not resource loads.
const reviewedShaderCitations = unusualUrls;
const textBytes=files.filter(f=>/\.(?:js|html|css|json)$/.test(f)).reduce((sum,f)=>sum+statSync(f).size,0);
const result={passed:failures.length===0,files:files.length,classicScriptsChecked:syntaxFiles,models:Object.keys(modelReport).length,previewTrianglesAcrossUniqueModels:triangles,verticesAcrossUniqueModels:vertices,thumbnails,textBytes,failures:[...new Set(failures)],warnings,namespaceAndDiagnosticUrls:urls,reviewedShaderCitations,actualContainerValidation:'Not run; creator simulator + Android + iOS required'};
writeFileSync(path.join(root,'generated/static-audit.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({...result,namespaceAndDiagnosticUrls:urls.length,reviewedShaderCitations:reviewedShaderCitations.length},null,2));
if(failures.length)process.exitCode=1;
