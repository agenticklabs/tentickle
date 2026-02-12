const c = "\x1b[36m"; // cyan
const cd = "\x1b[2;36m"; // cyan dim
const g = "\x1b[90m"; // gray
const w = "\x1b[1;37m"; // white bold
const cb = "\x1b[1;36m"; // cyan bold
const r = "\x1b[0m"; // reset

export function printBanner(): void {
  console.log(`${cd}                           ╭─╮${r}`);
  console.log(`${cd}                         ╭─╯ ╰─╮      ${g}╔═════╗${r}`);
  console.log(`${c}              ╭────╮   ╭─╯     ╰──╮   ${g}║${w} ◷   ${g}║${r}`);
  console.log(`${c}          ╭───╯    ╰───╯          ╰───${g}╢     ║${r}`);
  console.log(`${c}    ╭─────╯                           ${g}╚═════╝${r}`);
  console.log(`${c}  ──╯        ${cb}tentickle${g} — coding agent${r}`);
  console.log(`${cd}    ○   ○   ○   ○   ○   ○   ○   ○   ○   ○   ○   ○   ○${r}`);
  console.log();
}
