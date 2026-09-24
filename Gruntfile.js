const { requireToken } = require("./screeps.token");

module.exports = function (grunt) {
  grunt.loadNpmTasks("grunt-screeps");

  grunt.initConfig({
    screeps: {
      options: {
        // Токен берётся из process.env.SCREEPS_TOKEN или .screeps.json,
        // в репозитории секрет не хранится.
        token: requireToken(),
        branch: "test",
        ptr: false,
      },
      dist: {
        src: ["*.js", "!Gruntfile.js", "!screeps.token.js"],
      },
    },
  });
};
