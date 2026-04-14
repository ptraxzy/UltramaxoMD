const { gpti } = require('gpti');
gpti({
  messages: [{ role: 'user', content: 'halo kamus siapa' }],
  markdown: false,
  stream: false,
  model: 'v1/chat/completions'
}, (err, res) => {
  if (err) { console.log('ERROR:', err); }
  else { console.log('SUKSES:', res.gpt); }
});
