const expect = require('must');
const AnimeIndex = require('../lib/anime/index.js');

describe('anime', function () {
  this.timeout(20000);

  it('should initialize AnimeIndex', function () {
    const listBuilder = new AnimeIndex();
    expect(listBuilder).to.be.an.object();
  });

  // We can't easily run the full evaluate without API keys, 
  // but we can at least check if the modules load and the basics are there.
  it('should have an evaluate method', function () {
    const listBuilder = new AnimeIndex();
    expect(listBuilder.evaluate).to.be.a.function();
  });
});
