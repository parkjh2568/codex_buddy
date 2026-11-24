const fs=require('node:fs');
const path=require('node:path');
let ownArchive=null,archiveFs=null;
const archivePath=process.versions.electron?__dirname.match(/^(.*\.asar)(?:[/\\]|$)/)?.[1]:null;
if(archivePath){
  archiveFs=require('original-fs');const stat=archiveFs.lstatSync(archivePath,{throwIfNoEntry:false});
  if(stat?.isFile()&&!stat.isSymbolicLink()&&archiveFs.realpathSync(archivePath)===archivePath)ownArchive=archivePath;
}

function readBoundedFile(file,limit){
  if(!Number.isSafeInteger(limit)||limit<0)throw Error('파일 크기 한도를 확인해주세요.');
  const archived=ownArchive&&file.startsWith(ownArchive+path.sep),archiveBefore=archived?archiveFs.lstatSync(ownArchive):null;
  if(archived&&(!archiveBefore.isFile()||archiveBefore.isSymbolicLink()||archiveFs.realpathSync(ownArchive)!==ownArchive))throw Error('앱 리소스 파일 경로가 변경됐어요.');
  const expected=fs.lstatSync(file);
  if(!expected.isFile()||expected.isSymbolicLink()||fs.realpathSync(file)!==file)throw Error('파일 경로를 확인해주세요.');
  const descriptor=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0)|(fs.constants.O_NONBLOCK??0));
  try{
    const before=fs.fstatSync(descriptor);
    // ASAR의 가상 inode는 조회마다 바뀐다. 자기 번들은 FD와 물리 archive의 identity로 검증한다.
    if(!before.isFile()||(archived?before.size!==expected.size:before.dev!==expected.dev||before.ino!==expected.ino))throw Error('읽는 중 파일이 변경됐어요.');
    if(!Number.isSafeInteger(before.size)||before.size<0||before.size>limit)throw Error('파일 크기 한도를 확인해주세요.');
    const bytes=Buffer.alloc(before.size+1);let count=0;
    while(count<bytes.length){const read=fs.readSync(descriptor,bytes,count,Math.min(65536,bytes.length-count),null);if(!read)break;count+=read;}
    const after=fs.fstatSync(descriptor),current=fs.lstatSync(file);
    if(count!==before.size||!current.isFile()||current.isSymbolicLink()||fs.realpathSync(file)!==file||['dev','ino','size','mtimeMs','ctimeMs'].some(key=>after[key]!==before[key]||(!(archived&&key==='ino')&&current[key]!== (archived?expected[key]:before[key]))))throw Error('읽는 중 파일이 변경됐어요.');
    if(archived){const currentArchive=archiveFs.lstatSync(ownArchive);if(!currentArchive.isFile()||currentArchive.isSymbolicLink()||archiveFs.realpathSync(ownArchive)!==ownArchive||['dev','ino','size','mtimeMs','ctimeMs'].some(key=>currentArchive[key]!==archiveBefore[key]))throw Error('읽는 중 앱 리소스 파일이 변경됐어요.');}
    return bytes.subarray(0,count);
  }finally{fs.closeSync(descriptor);}
}
module.exports={readBoundedFile};
