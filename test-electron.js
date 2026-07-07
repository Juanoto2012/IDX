const { app } = require('electron');
console.log('app:', typeof app);
console.log('whenReady:', typeof app.whenReady);
app.whenReady().then(() => {
  console.log('ready');
});
