const e = "\x1b[38;2;52;211;153m"; // #34d399 emerald
const ed = "\x1b[2;38;2;52;211;153m"; // emerald dim
const g = "\x1b[90m"; // gray
const w = "\x1b[1;37m"; // white bold
const eb = "\x1b[1;38;2;52;211;153m"; // emerald bold
const r = "\x1b[0m"; // reset

export function printBanner(): void {
  console.log(`${ed}                           ╭─╮${r}`);
  console.log(`${ed}                         ╭─╯ ╰─╮      ${g}╔═════╗${r}`);
  console.log(`${e}              ╭────╮   ╭─╯     ╰──╮   ${g}║${w} ◷   ${g}║${r}`);
  console.log(`${e}          ╭───╯    ╰───╯          ╰───${g}╢     ║${r}`);
  console.log(`${e}    ╭─────╯                           ${g}╚═════╝${r}`);
  console.log(`${e}  ──╯        ${eb}tentickle${g} — coding agent${r}`);
  console.log(`${ed}    ○   ○   ○   ○   ○   ○   ○   ○   ○   ○   ○   ○   ○${r}`);
  console.log();
}
