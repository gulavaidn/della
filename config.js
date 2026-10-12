module.exports = {
  botName: 'MyBot',
  prefix: '.',
  // Nomor owner (format internasional, tanpa +). Contoh: Indonesia -> 628xxxxxxxxxx
  owner: '628xxxxxxxxxx',
  // Nomor yang dipakai sebagai bot (untuk login pairing code). Kosongkan untuk ditanya saat start.
  phoneNumber: '',
  // Opsional: fitur .ai memakai Claude API. Isi lewat env: export ANTHROPIC_API_KEY=sk-ant-...
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  aiModel: 'claude-sonnet-5-5',
};
