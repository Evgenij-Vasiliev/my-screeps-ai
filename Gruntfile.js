module.exports = function (grunt) {
  grunt.loadNpmTasks("grunt-screeps");

  grunt.initConfig({
    screeps: {
      options: {
        token: "[REDACTED-SCREEPS-TOKEN]",
        branch: "test",
        ptr: false,
      },
      dist: {
        src: ["*.js", "!Gruntfile.js"],
      },
    },
  });
};
