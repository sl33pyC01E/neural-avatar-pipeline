#include <sys/prctl.h>
#include <signal.h>
#include <stdio.h>
#include <unistd.h>
// Preserve Android service ownership even if a native crash kills the parent.
int main(int argc, char **argv) {
    if (argc < 3) return 2;
    pid_t parent = getppid();
    if (prctl(PR_SET_PDEATHSIG, SIGKILL) || parent == 1 || getppid() != parent) return 3;
    FILE *pid = fopen(argv[1], "w");
    if (!pid) return 4;
    fprintf(pid, "%d\n", getpid()); fclose(pid);
    execv(argv[2], &argv[2]); perror("exec llama-server"); return 5;
}
