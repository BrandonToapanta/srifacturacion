<?php
$fw = fopen("./local.ss.rpz.zone",'w');
$list = array(
"searchengines"
); 

fwrite($fw,"\$TTL    86400
@       IN      SOA     @ root (
                        154     ; Serial, this is www.ehcp.net dns zone templat$
                        10800   ; Refresh
                        1200     ; Retry
                        86400  ; Expire
                        86400 ) ; Minimum
        IN NS   LOCALHOST.
");
foreach ($list as $value) {
    echo "$value ok
";
$handle = @fopen($value."/domains", "r");
if ($handle) {
while (($buffer = fgets($handle, 4096)) !== false) {
$error = 0;
$pos = strrpos($buffer, '.');
if($pos===false) {
$error = 1;
} 

$pos = strrpos($buffer, ".\n");
if($pos!==false){
$error = 1;
} 

$pos = substr($buffer,0,1);
if($pos=='.'){
echo "$buffer
";
$error = 1;
}

if ($error == 0) {
fwrite($fw,trim($buffer)."  IN CNAME        .");
    fwrite($fw,"
*.".trim($buffer)."     IN CNAME        .
");
}
}

}
    if (!feof($handle)) {
        echo "Error: unexpected fgets() fail\n";
    }
    fclose($handle);
}

?>

