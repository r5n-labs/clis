export type AtlasConfig = {
  $schema?: string;
  ignore: string[];
  maxDepth: number;
  output: {
    format: "json" | "yaml";
    file?: string;
  };
};
