yarn build
rsync -av --delete ./dist/ ~/yadacoin/plugins/yadacoinwallet/web/
cp ./dist/index.html ~/yadacoin/plugins/yadacoinwallet/templates/wallet.html
