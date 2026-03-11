module.exports = {
  apps: [
    {
      name: 'main-app',
      script: 'src/main.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '500M',
    },
    {
      name: 'naukri-worker',
      script: 'src/scrapers/naukri/workers/naukriworker.js',
      instances: 1,          // ← must be 1, browser + shared cache can't be clustered
      exec_mode: 'fork',     // ← fork not cluster
      interpreter: 'bash',
      interpreter_args: '-c "xvfb-run -a node src/scrapers/naukri/workers/naukriworker.js"',
      max_memory_restart: '800M', // ← increase, browser takes more memory
    },
    {
      name: 'location-done-worker',
      script: 'src/scrapers/naukri/workers/locationdoneworker.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '500M',
    },

    {
      name: 'cleaner-worker',
      script: 'src/workers/cleanworker.js',
      instances: 2,
      exec_mode: 'cluster',
      max_memory_restart: '500M',
    },
  ],
};
