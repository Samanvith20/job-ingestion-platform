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
      script: 'src/scrapers/naukuri/worker/naukriworker.js',
      instances: 2,
      exec_mode: 'cluster',
      max_memory_restart: '500M',
    },
    {
        name:'location-done-worker',
        script: 'src/scrapers/naukuri/worker/locationdoneworker.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '500M',
    },

    
    

    {
      name: 'cleaner-worker',
      script: 'src/workers/cleanerWorker.js',
      instances: 2,
      exec_mode: 'cluster',
      max_memory_restart: '500M',
    },
    
  ],
};
