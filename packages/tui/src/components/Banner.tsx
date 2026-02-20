// const e = "\x1b[38;2;52;211;153m"; // #34d399 emerald
const ed = "\x1b[2;38;2;52;211;153m"; // emerald dim

const bannerWidth = 77; // Total width of the ASCII art lines, derived from existing lines

function centerText(text: string): string {
  const padding = bannerWidth - text.length;
  const leftPadding = Math.floor(padding / 2);
  const rightPadding = Math.ceil(padding / 2);
  return `${" ".repeat(leftPadding)}${text}${" ".repeat(rightPadding)}`;
}

// const g = "\x1b[90m"; // gray
// const w = "\x1b[1;37m"; // white bold
// const eb = "\x1b[1;38;2;52;211;153m"; // emerald bold
// const r = "\x1b[0m"; // reset

export function printBanner(projectName: string, projectAuthor: string): void {
  console.log();
  console.log(`${ed}                              @@@@@@@@@@@@@@@                                `);
  console.log(`${ed}                         @@@@@@@@@@@@@@@@@@@@@@@@                            `);
  console.log(`${ed}                       @@@@@@@@@           @@@@@@@@@                         `);
  console.log(`${ed}                    @@@@@@@                    @@@@@@@                       `);
  console.log(`${ed}                   @@@@@@                          @@@@@                     `);
  console.log(`${ed}                 @@@@                                @@@@                    `);
  console.log(`${ed}                @@@@@                                  @@@                   `);
  console.log(`${ed}               @@@                                      @@@                  `);
  console.log(`${ed}               @@                                        @@@                 `);
  console.log(`${ed}              @@@          @@@             @@@            @@                 `);
  console.log(`${ed}              @@          @@@@@           @@@@@           @@@                `);
  console.log(`${ed}              @@         @@   @@         @@   @@           @@                `);
  console.log(`${ed}              @@         @@ @ @@         @@ @ @@           @@                `);
  console.log(`${ed}              @@          @@@@@           @@@@@            @@                `);
  console.log(`${ed}              @@           @@@             @@@             @@                `);
  console.log(`${ed}              @@                                           @@                `);
  console.log(`${ed}      @@@@    @@                 @     @                   @@    @@@         `);
  console.log(`${ed}    @@@@@@@   @@                  @@@@@                   @@@   @@@@@        `);
  console.log(`${ed}    @@@ @@@@  @@                                          @@   @@@ @@@       `);
  console.log(`${ed}   @@@    @@@@@@                                          @@@@@@@    @@      `);
  console.log(`${ed}   @@@    @@@@@                                           @@@@@@@    @@      `);
  console.log(`${ed}   @@@                                                               @@      `);
  console.log(`${ed}     @@@  @           @                           @@           @   @@@       `);
  console.log(`${ed}      @@@@            @              @             @            @@@@@        `);
  console.log(`${ed}       @@@           @              @@@             @           @@@          `);
  console.log(`${ed}        @@        @@@@             @  @@            @@@@        @@@          `);
  console.log(`${ed}        @@@@    @@@@@@@          @@    @@@          @@@@@@@    @@@           `);
  console.log(`${ed}         @@@@@@@@@@  @@@@     @@@@      @@@@       @@   @@@@@@@@@            `);
  console.log(`${ed}           @@@@@      @@@@@@@@@@@        @@@@@@@@@@@       @@@@@             `);
  console.log(`${ed}                        @@@@@@@            @@@@@@@@                          `);
  console.log();
  console.log(`${ed}${centerText(`Project: ${projectName}`)}`);
  console.log(`${ed}${centerText(`Author: ${projectAuthor}`)}`);
  console.log();
}
