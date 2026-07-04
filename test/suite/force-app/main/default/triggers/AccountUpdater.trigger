trigger AccountUpdater on Account (before insert, before update) {
    TopLevelClass.doSomething();
}
