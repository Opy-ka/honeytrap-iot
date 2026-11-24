#ifndef PQCLEAN_COMPAT_H
#define PQCLEAN_COMPAT_H

/* Prevents compiler from turning constant-time cmov into a branch */
#if defined(__GNUC__) || defined(__clang__)
#define PQCLEAN_PREVENT_BRANCH_HACK(b) __asm__ volatile("" : "+r"(b) :)
#else
#define PQCLEAN_PREVENT_BRANCH_HACK(b) do {} while (0)
#endif

#endif
