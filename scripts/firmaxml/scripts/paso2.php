<?php


$db = mysqli_init();
$db->real_connect("127.0.0.1","root","disisot4567","websegura");

$file="/etc/bind/rpz/local.rpz.zone.tmp";
if (file_exists($file)) {
    echo "El fichero $file existe";
    unlink($file);
} else {
    echo "El fichero $file no existe";
}


$fw = fopen("/etc/bind/rpz/local.rpz.zone.tmp",'w');
fwrite($fw,"\$TTL    86400
@       IN      SOA     @ root (
                        154     ; Serial, this is www.ehcp.net dns zone templat$
                        10800   ; Refresh
                        1200     ; Retry
                        86400  ; Expire
                        86400 ) ; Minimum
        IN NS   LOCALHOST.
");

fclose($fw);

$fw = fopen("/etc/bind/rpz/local.rpz.zone.tmp",'a');

$query = "SELECT DNS, 'IN CNAME' AS POLICY, '.' AS HOST FROM DB_LISTA_NEGRA WHERE HABILITADO = 1 AND LISTA_BLANCA = 0";

if ($result = $db->query($query)) {
$i = 0;
    /* fetch object array */
    while ($row = $result->fetch_row()) {
    //    printf ("%s (%s)\n", $row[0], $row[1]);
      fwrite($fw, $row[0]."\t".$row[1]."\t".$row[2]."\r\n");
      fwrite($fw, "*.".$row[0]."\t".$row[1]."\t".$row[2]."\r\n");
    }

    /* free result set */
    $result->close();
} else {
printf("Errormessage: %s\n", $db->error);
}
fclose($fw);

?>

