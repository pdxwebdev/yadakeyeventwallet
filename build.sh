find . -type f -name '*.jsx' -exec sed -i '' s/config/config.prod/g {} +
yarn build
find . -type f -name '*.jsx' -exec sed -i '' s/config.prod/config/g {} +
rsync -avz --delete ./dist/* 10.0.0.168:/media/john/4tb/home/mvogel/yadacoin/static/wallet
mv dist/index.html dist/wallet.html
scp ./dist/wallet.html 10.0.0.168:/media/john/4tb/home/mvogel/yadacoin/templates/wallet.html