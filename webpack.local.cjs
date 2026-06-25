const path = require("node:path");
const webpack = require("webpack");

module.exports = {
  mode: "development",
  entry: path.resolve(__dirname, "src/main.jsx"),
  output: {
    path: path.resolve(__dirname, "dist-webpack/assets"),
    filename: "main.js",
    publicPath: "/assets/",
    assetModuleFilename: "[name][ext]"
  },
  devtool: "source-map",
  resolve: {
    extensions: [".js", ".jsx"]
  },
  module: {
    rules: [
      {
        test: /\.[jt]sx?$/,
        exclude: /node_modules/,
        use: {
          loader: "babel-loader",
          options: {
            presets: [
              ["@babel/preset-env", { targets: "defaults" }],
              ["@babel/preset-react", { runtime: "automatic" }]
            ]
          }
        }
      },
      {
        test: /\.css$/,
        use: ["style-loader", "css-loader"]
      },
      {
        test: /\.(png|svg|jpg|jpeg|webp|gif)$/i,
        type: "asset/resource"
      }
    ]
  },
  plugins: [
    new webpack.DefinePlugin({
      "import.meta.env.DEV": JSON.stringify(false),
      "import.meta.env.VITE_API_BASE_URL": JSON.stringify("http://127.0.0.1:8791")
    })
  ]
};
