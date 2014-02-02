var Job = require('../lib/job');
var Queue = require('../');
var expect = require('expect.js');
var bluebird = require('bluebird');

var STD_QUEUE_NAME = 'test queue 2';

describe('Queue', function(){
  var queue;
  
  beforeEach(function(done){
    queue = Queue(STD_QUEUE_NAME, 6379, '127.0.0.1');
    done();
  });
  
  afterEach(function(done){
    queue.close();
    done();
  })
  
  it('create a queue with standard redis opts', function(done){
    var queue = Queue('standard');
    
    queue.once('ready', function(){
      expect(queue.client.host).to.be('127.0.0.1');
      expect(queue.bclient.host).to.be('127.0.0.1');
      
      expect(queue.client.port).to.be(6379);
      expect(queue.bclient.port).to.be(6379);
      
      expect(queue.client.selected_db).to.be(0);
      expect(queue.bclient.selected_db).to.be(0);
            
      done();
    });
  });
  
  it('create a queue using custom redis paramters', function(done){
    var queue = Queue('custom', {redis: {DB: 1}});
    
    queue.once('ready', function(){
      expect(queue.client.host).to.be('127.0.0.1');
      expect(queue.bclient.host).to.be('127.0.0.1');
      
      expect(queue.client.port).to.be(6379);
      expect(queue.bclient.port).to.be(6379);
      
      expect(queue.client.selected_db).to.be(1);
      expect(queue.bclient.selected_db).to.be(1);
            
      done();
    });  
  })

  it('process a job', function(done){
    queue.process(function(job, jobDone){
      expect(job.data.foo).to.be.equal('bar')
      jobDone();
      done();
    })
    
    queue.add({foo: 'bar'}).then(function(job){
      expect(job.jobId).to.be.ok()
      expect(job.data.foo).to.be('bar')
    }, function(err){
      done(err);
    });
  });
  
  it('process a job that updates progress', function(done){
    queue.process(function(job, jobDone){
      expect(job.data.foo).to.be.equal('bar')
      job.progress(42);
      jobDone();
    });
    
    queue.add({foo: 'bar'}).then(function(job){
      expect(job.jobId).to.be.ok()
      expect(job.data.foo).to.be('bar');
    }, function(err){
      done(err);
    });
    
    queue.on('progress', function(job, progress){
      expect(job).to.be.ok();
      expect(progress).to.be.eql(42);
      done();
    });
  });
  
  it('process a job that returns data in the process handler', function(done){
    queue.process(function(job, jobDone){
      expect(job.data.foo).to.be.equal('bar')
      jobDone(null, 37);
    });
    
    queue.add({foo: 'bar'}).then(function(job){
      expect(job.jobId).to.be.ok()
      expect(job.data.foo).to.be('bar');
    }, function(err){
      done(err);
    });
    
    queue.on('completed', function(job, data){
      expect(job).to.be.ok();
      expect(data).to.be.eql(37);
      done();
    });
  });

  it('process a stalled job when starting a queue', function(done){
    var queueStalled = Queue('test queue stalled', 6379, '127.0.0.1');
    queueStalled.LOCK_RENEW_TIME = 10;
    var jobs = [
      queueStalled.add({bar: 'baz'}), 
      queueStalled.add({bar1: 'baz1'}),
      queueStalled.add({bar2: 'baz2'}),
      queueStalled.add({bar3: 'baz3'})];
      
    bluebird.all(jobs).then(function(){
      queueStalled.process(function(job){
        // instead of completing we just close the queue to simulate a crash.
        queueStalled.close();
  
        setTimeout(function(){
          var queue2 = Queue('test queue stalled', 6379, '127.0.0.1');
          queue2.process(function(job, jobDone){
            jobDone();
          })

          var counter = 0;
          queue2.on('completed', function(job){
            counter ++;
            if(counter === 4) {
              done();
            }
          });
        }, 100);
      });
    })
  });


  it('process several stalled jobs when starting several queues', function(done){
    var NUM_QUEUES = 10;
    var NUM_JOBS_PER_QUEUE = 20;
    var stalledQueues = [];
    var jobs = [];
    for(var i=0; i<NUM_QUEUES; i++){
      var queue = Queue('test queue stalled 2', 6379, '127.0.0.1');
      stalledQueues.push(queue);
      queue.LOCK_RENEW_TIME = 10;
      
      for(var j=0; j<NUM_JOBS_PER_QUEUE; j++){
        jobs.push(queue.add({job: j}));
      }
    }

    bluebird.all(jobs).then(function(){
      var processed = 0;
      for(var k=0; k<stalledQueues.length; k++){
        stalledQueues[k].process(function(job){
          // instead of completing we just close the queue to simulate a crash.
          this.close();
          
          processed ++;
          if(processed === stalledQueues.length){
            setTimeout(function(){
              var queue2 = Queue('test queue stalled 2', 6379, '127.0.0.1');
              queue2.process(function(job, jobDone){
                jobDone();
              });

              var counter = 0;
              queue2.on('completed', function(job){
                counter ++;
                if(counter === NUM_QUEUES * NUM_JOBS_PER_QUEUE) {
                  done();
                }
              });
            }, 100);
          }
        });
      }
    });
  });
  
  it('does not process a job that is being processed when a new queue starts', function(done){
    var jobId;
    queue.add({foo: 'bar'}).then(function(job){
      jobId = job.jobId;
    });
    
    queue.process(function(job, jobDone){
      expect(job.data.foo).to.be.equal('bar')
      
      if(jobId !== job.jobId){
        done(Error("Missmatch job ids"));
      }

      setTimeout(function(){
        jobDone();
      }, 100);
    });
    
    queue.on('completed', function(job){
      anotherQueue.close();
      done();
    });
    
    var anotherQueue = Queue(STD_QUEUE_NAME, 6379, '127.0.0.1');

    setTimeout(function(){
      anotherQueue.process(function(job, jobDone){
        if(job.jobId === jobId){
          done(Error("SHOULD NOT PROCESS"));
        }
        jobDone();
      });
    }, 50);
  });
  
  it.skip('process stalled jobs without requiring a queue restart');

  it('process a job that fails', function(done){
    var jobError = Error("Job Failed");
    queue.process(function(job, jobDone){
      expect(job.data.foo).to.be.equal('bar')
      jobDone(jobError);
    })
    
    queue.add({foo: 'bar'}).then(function(job){
      expect(job.jobId).to.be.ok()
      expect(job.data.foo).to.be('bar')
    }, function(err){
      done(err);
    });
    
    queue.once('failed', function(job, err){
      expect(job.jobId).to.be.ok()
      expect(job.data.foo).to.be('bar')
      expect(err).to.be.eql(jobError);
      done();
    });
  });
  
  it('process a job that throws an exception', function(done){
    var jobError = new Error("Job Failed");
    queue.process(function(job, jobDone){
      expect(job.data.foo).to.be.equal('bar')
      throw jobError;
    });
    
    queue.add({foo: 'bar'}).then(function(job){
      expect(job.jobId).to.be.ok()
      expect(job.data.foo).to.be('bar')
    }, function(err){
      done(err);
    });
    
    queue.once('failed', function(job, err){
      expect(job.jobId).to.be.ok()
      expect(job.data.foo).to.be('bar')
      expect(err).to.be.eql(jobError);
      done();
    });
  });
  
  it.skip('retry a job that fails', function(done){
    var jobError = new Error("Job Failed");
    queue.process(function(job, jobDone){
      expect(job.data.foo).to.be.equal('bar')
      jobDone(jobError);
    })
    
    queue.add({foo: 'bar'}).then(function(job){
      expect(job.jobId).to.be.ok()
      expect(job.data.foo).to.be('bar')
    }, function(err){
      done(err);
    });
    
    queue.once('failed', function(job, err){
      expect(job.jobId).to.be.ok()
      expect(job.data.foo).to.be('bar')
      expect(err).to.be.eql(jobError);
      done();
    });
  });
  
  it('process several jobs serially', function(done){
    var counter = 1;
    var maxJobs = 100;
    queue.process(function(job, jobDone){
      expect(job.data.num).to.be.equal(counter);
      expect(job.data.foo).to.be.equal('bar');
      jobDone();
      if(counter == maxJobs) done();
      counter++;
    });
    
    for(var i=1; i<=maxJobs; i++){
      queue.add({foo: 'bar', num: i});
    }
  });
  
  it('count added, unprocessed jobs', function(done){
    var counter = 1;
    var maxJobs = 100;
    var added = [];
    
    for(var i=1; i<=maxJobs; i++){
      added.push(queue.add({foo: 'bar', num: i}));
    }
    
    bluebird.all(added).then(function(){
      queue.count().then(function(count){
        expect(count).to.be(100);
      
        queue.process(function(job, jobDone){
          expect(job.data.num).to.be.equal(counter);
          expect(job.data.foo).to.be.equal('bar');
          jobDone();
          if(counter == maxJobs) done();
          counter++;
        });
      });
    });
  });
  
  it('add jobs to a paused queue', function(done){
    var ispaused = false, counter = 2;
    
    queue.process(function(job, jobDone){
      expect(ispaused).to.be(false);
      expect(job.data.foo).to.be.equal('paused');
      jobDone();
      counter--;
      if(counter === 0) done();
    });
    
    queue.pause();
    
    ispaused = true;
    
    queue.add({foo: 'paused'});
    queue.add({foo: 'paused'});
    
    setTimeout(function(){
      ispaused = false;
      queue.resume();
    }, 100); // We hope that this was enough to trigger a process if
    // we were not paused.
  });
  
  it('paused a running queue', function(done){
    var ispaused = false, isresumed = true, first = true;
    
    queue.process(function(job, jobDone){
      expect(ispaused).to.be(false);
      expect(job.data.foo).to.be.equal('paused');
      jobDone();
      
      if(first){
        first = false;
        queue.pause();
        ispaused = true;
      }else{
        expect(isresumed).to.be(true);
        done();
      }  
    });
        
    queue.add({foo: 'paused'});
    queue.add({foo: 'paused'});
    
    queue.on('paused', function(){
      setTimeout(function(){
        ispaused = false;
        queue.resume();
      }, 100); // We hope that this was enough to trigger a process if
    });
    
    queue.on('resumed', function(){
      isresumed = true;
    });
    
  });
  
});