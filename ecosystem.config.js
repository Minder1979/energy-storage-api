module.exports = {
  apps: [{
    name: 'energy-api',
    script: 'server.js',
    cwd: '/home/ubuntu/energy-storage-api',
    env: {
      PORT: 3000,
      NODE_ENV: 'production',
    },
    instances: 1,
    autorestart: true,
    max_memory_restart: '200M',
  }]
};
