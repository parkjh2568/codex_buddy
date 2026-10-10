const { parentPort, workerData } = require('node:worker_threads');
const { Store } = require('./store.cjs');
const store = new Store(workerData.directory,{});
parentPort.on('message', message => {
  try {
    store.data = message.data;
    if ('snapshot' in message) store.snapshot = message.snapshot;
    store.save();
    parentPort.postMessage({ok:true,activeConversationId:store.data.activeConversationId,conversations:store.data.conversations,snapshot:store.snapshot});
  } catch (error) { parentPort.postMessage({ok:false,error:error.message,warning:store.warning,writeBlocked:store.writeBlocked}); }
});
