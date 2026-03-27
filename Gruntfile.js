module.exports = function (grunt) {
  grunt.loadNpmTasks("grunt-screeps");

  grunt.initConfig({
    screeps: {
      options: {
        token: "65d562cb-017c-4030-bd5f-205dabc8de94",
        branch: "test",
        ptr: false,
      },
      dist: {
        src: ["*.js", "!Gruntfile.js"],
      },
    },
  });
};
