#!/bin/bash
# shalla black list
rm -rf  /root/blacklist/shallalist.tar.gz 
rm -rf  /root/blacklist/SHALLA
wget -P /root/blacklist http://www.shallalist.de/Downloads/shallalist.tar.gz
tar xvf /root/blacklist/shallalist.tar.gz -C /root/blacklist
mv -fv /root/blacklist/BL /root/blacklist/SHALLA 
php paso1.php SHALLA
# MESD black list
rm -rf  /root/blacklist/blacklists.tgz
rm -rf  /root/blacklist/MESD
wget -P /root/blacklist http://squidguard.mesd.k12.or.us/blacklists.tgz
tar xvf /root/blacklist/blacklists.tgz -C /root/blacklist
mv -fv /root/blacklist/blacklists /root/blacklist/MESD
php paso1.php MESD
php paso2.php
mv /etc/bind/rpz/local.rpz.zone  /etc/bind/rpz/local.rpz.zone.bk
mv /etc/bind/rpz/local.rpz.zone.tmp  /etc/bind/rpz/local.rpz.zone 
