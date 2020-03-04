const gulp = require('gulp');
const path = require('path');
const { spawn } = require('child_process');
const PluginError = require('plugin-error');
const log = require('fancy-log');
const webpack = require('webpack');
const sass = require('node-sass');
const fs = require('fs');


function setProduction(done){
    process.env.NODE_ENV = 'production';
    done();
}

function setQuick(done){
    process.env.NODE_ENV = 'quick';
    done();
}

function setDevelopment(done){
    process.env.NODE_ENV = 'development';
    done();
}

function webpackOnBuild(done) {
    var start = Date.now();
    return function (err, stats) {
        if (err) {
            throw new PluginError("webpack", err);
        }
        log("[webpack]", stats.toString({
            colors: true
        }));
        var end = Date.now();
        log("Build Completed, running for " + ((end - start)/1000)) + 's';
        if (done) { done(err); }
    };
}

function doWebpack(cb){
    // Import in here so process.env.NODE_ENV changes are picked up.
    const webpackConfig = require('./webpack.config.js');
    webpack(webpackConfig).run(webpackOnBuild(cb));
}

function watch(){
    // Import in here so process.env.NODE_ENV changes are picked up.
    const webpackConfig = require('./webpack.config.js');
    webpack(webpackConfig).watch(300, webpackOnBuild());
}

function getSharedPortalComponentsLink(){
    let sharedComponentPath = path.resolve(__dirname, 'node_modules/@hms-dbmi-bgm/shared-portal-components');
    let isLinked = false;

    try { // Get exact path to dir, else leave. Used to avoid needing to webpack dependency itself.
        for (var i = 0; i < 10; i++) { // Incase multiple links.
            sharedComponentPath = fs.readlinkSync(sharedComponentPath);
            isLinked = true;
        }
    } catch (e){
        // ... not linked
    }

    console.log(
        "`@hms-dbmi-bgm/shared-portal-components` directory is",
        isLinked ? "sym-linked to `" + sharedComponentPath + "`." : "NOT sym-linked."
    );

    return { isLinked, sharedComponentPath: isLinked ? sharedComponentPath : null };
}

function buildSharedPortalComponents(done){
    const { isLinked, sharedComponentPath } = getSharedPortalComponentsLink();

    if (!isLinked){ // Exit
        done();
        return;
    }

    // Same as shared-portal-components own build method, but with "--watch"
    const subP = spawn(
        path.join(sharedComponentPath, 'node_modules/.bin/babel'),
        [
            path.join(sharedComponentPath, 'src'),
            "--out-dir",
            path.join(sharedComponentPath, 'es'),
            "--env-name",
            "esm"
        ],
        { stdio: "inherit" }
    );

    subP.on("close", (code)=>{
        done();
    });
}

function watchSharedPortalComponents(done){
    const { isLinked, sharedComponentPath } = getSharedPortalComponentsLink();

    if (!isLinked){ // Exit
        done();
        return;
    }

    // Same as shared-portal-components own build method, but with "--watch"
    const subP = spawn(
        path.join(sharedComponentPath, 'node_modules/.bin/babel'),
        [
            path.join(sharedComponentPath, 'src'),
            "--out-dir",
            path.join(sharedComponentPath, 'es'),
            "--env-name",
            "esm",
            "--watch"
        ],
        { stdio: "inherit" }
    );

    subP.on("close", (code)=>{
        done();
    });
}

function getMicroscopyMetadataToolLink(){
    let metadataToolPath = path.resolve(__dirname, 'node_modules/4dn-microscopy-metadata-tool');
    let isLinked = false;

    try { // Get exact path to dir, else leave. Used to avoid needing to webpack dependency itself.
        for (var i = 0; i < 10; i++) { // Incase multiple links.
            metadataToolPath = fs.readlinkSync(metadataToolPath);
            isLinked = true;
        }
    } catch (e){
        // ... not linked
    }

    console.log(
        "`4dn-microscopy-metadata-tool` directory is",
        isLinked ? "sym-linked to `" + metadataToolPath + "`." : "NOT sym-linked."
    );

    return { isLinked, metadataToolPath: isLinked ? metadataToolPath : null };
}

function buildMicroscopyMetadataTool(done){
    const { isLinked, metadataToolPath } = getMicroscopyMetadataToolLink();

    if (!isLinked){ // Exit
        done();
        return;
    }

    // Same as 4dn-microscopy-metadata-tool own build method, but with "--watch"
    const subP = spawn(
        path.join(metadataToolPath, 'node_modules/.bin/babel'),
        [
            path.join(metadataToolPath, 'src'),
            "--out-dir",
            path.join(metadataToolPath, 'es'),
            "--env-name",
            "esm"
        ],
        { stdio: "inherit" }
    );

    subP.on("close", (code)=>{
        done();
    });
}

function watchMicroscopyMetadataTool(done){
    const { isLinked, metadataToolPath } = getMicroscopyMetadataToolLink();

    if (!isLinked){ // Exit
        done();
        return;
    }

    // Same as 4dn-microscopy-metadata-tool own build method, but with "--watch"
    const subP = spawn(
        path.join(metadataToolPath, 'node_modules/.bin/babel'),
        [
            path.join(metadataToolPath, 'src'),
            "--out-dir",
            path.join(metadataToolPath, 'es'),
            "--env-name",
            "esm",
            "--watch"
        ],
        { stdio: "inherit" }
    );

    subP.on("close", (code)=>{
        done();
    });
}


// TODO: Just use command-line `node-sass` ?

const cssOutputLocation = './src/encoded/static/css/style.css';
const sourceMapLocation = "./src/encoded/static/css/style.css.map";

const doSassBuild = (done, options = {}) => {
    sass.render({
        file: './src/encoded/static/scss/style.scss',
        outFile: cssOutputLocation,
        outputStyle: options.outputStyle || 'compressed',
        sourceMap: sourceMapLocation
    }, function(error, result) { // node-style callback from v3.0.0 onwards
        if (error) {
            console.error("Error", error.status, error.file, error.line + ':' + error.column);
            console.log(error.message);
            done();
        } else {
            //console.log(result.css.toString());

            console.log("Finished compiling SCSS in", result.stats.duration, "ms");
            console.log("Writing to", cssOutputLocation);

            let countCompleted = 0;

            fs.writeFile(cssOutputLocation, result.css.toString(), null, function(err){
                if (err){
                    return console.error(err);
                }
                console.log("Wrote " + cssOutputLocation);
                countCompleted++;
                if (countCompleted === 2){
                    done();
                }
            });

            fs.writeFile(sourceMapLocation, result.map.toString(), null, function(err){
                if (err){
                    return console.error(err);
                }
                console.log("Wrote " + sourceMapLocation);
                countCompleted++;
                if (countCompleted === 2){
                    done();
                }
            });
        }
    });
};


//const devSlow = gulp.series(setDevelopment, doWebpack, watch);
//const buildQuick = gulp.series(setQuick, doWebpack);


const devQuick = gulp.series(
    setQuick,
    doWebpack,
    gulp.parallel(watch, watchSharedPortalComponents, watchMicroscopyMetadataTool)
    // `watchSharedPortalComponents` will update @hms-dbmi-bgm/shared-portal-components/es/,
    // `watchMicroscopyMetadataTool` will update 4dn-microscopy-metadata-tool/es/,
    // which will be picked up by `watch` and recompiled into bundle.js
);

const devAnalyzed = gulp.series(
    setDevelopment,
    buildSharedPortalComponents,
    buildMicroscopyMetadataTool,
    doWebpack
);

const build = gulp.series(
    setProduction,
    doWebpack
);


//gulp.task('dev', devSlow);
//gulp.task('build-quick', buildQuick);


gulp.task('default', devQuick);
gulp.task('dev-quick', devQuick);
gulp.task('dev-analyzed', devAnalyzed);
gulp.task('build', build);


gulp.task('build-scss', (done) => doSassBuild(done, {}));
gulp.task('build-scss-dev', (done) => {
    doSassBuild(
        () => {
            console.log('Watching for changes (if ran via `npm run watch-scss`)');
            done();
        },
        { outputStyle : 'expanded' }
    );
});

