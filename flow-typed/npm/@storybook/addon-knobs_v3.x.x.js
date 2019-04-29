// flow-typed signature: 2be09489aa5b13abeac6cff77889482f
// flow-typed version: d31d780f52/@storybook/addon-knobs_v3.x.x/flow_vx.x.x

declare module "@storybook/addon-knobs/react" {
  declare type Context = { kind: string, story: string };
  declare type Renderable = React$Element<*>;
  declare type RenderFunction = () => Renderable | Array<Renderable>;
  declare type GroupId = string;

  declare function array<T>(string, (Array<T> | {[string]: T}), ?string, ?GroupId): Array<T>;
  declare function boolean(string, boolean, ?GroupId): boolean;
  declare function button(string, ((?{}) => void), ?GroupId): void;
  declare function color(string, string, ?GroupId): string;
  declare function date(string, Date, ?GroupId): number;
  declare function number(string, number, ?{ range?: boolean, min?: number, max?: number, step?: number }, ?GroupId): number;
  declare function object(string, any, ?GroupId): any;
  declare function select<T>(string, Array<T> | { [T]: string }, T, ?GroupId): T;
  declare function selectV2<T>(string, Array<T> | { [string]: T }, T, ?GroupId): T;
  declare function text(string, string, ?GroupId): string;
  declare function withKnobs(
    story: RenderFunction,
    context: Context
  ): Renderable | null;
}
