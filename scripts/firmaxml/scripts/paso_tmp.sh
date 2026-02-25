#!/bin/bash
rm -rf /etc/bind/rpz/local.rpz.zone.bk
mv /etc/bind/rpz/local.rpz.zone  /etc/bind/rpz/local.rpz.zone.bk
mv /etc/bind/rpz/local.rpz.zone.tmp  /etc/bind/rpz/local.rpz.zone 
service bind9 restart
