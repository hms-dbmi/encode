
module.exports = function(api){
    const modulesEnabled = api.env("test");
    api.cache.using(function(){ return process.env.NODE_ENV; });
    return {
        "presets" : [
            // We don't need to convert import/export statements unless in test/Jest environment (as Webpack will handle later; not converting here preserves code-splitting).
            // @see https://stackoverflow.com/questions/63563485/how-can-i-preserve-dynamic-import-statements-with-babel-preset-env
            [ "@babel/preset-env", { "modules": modulesEnabled ? "auto" : false } ],
            "@babel/preset-react",
        ],
        "plugins": [
            "@babel/plugin-syntax-dynamic-import",
            "@babel/plugin-proposal-object-rest-spread",
            "@babel/plugin-proposal-class-properties",
            "babel-plugin-minify-dead-code-elimination"
        ],
        "comments": true
    };
};
