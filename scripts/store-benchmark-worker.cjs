const {workerData,parentPort}=require('node:worker_threads');
const {installProbe}=require('./store-benchmark-probe.cjs');
const probe=installProbe(),post=parentPort.postMessage;
parentPort.postMessage=function(message,...args){const measurement=probe.stop();try{return post.call(this,{...message,benchmarkProbe:measurement},...args);}finally{probe.start();}};
probe.start();require(workerData.benchmarkTarget);
