/**
 *
 * @author ccarreno
 */
import org.w3c.dom.Element;
import java.io.FileNotFoundException;
import java.io.IOException;
import javax.xml.parsers.ParserConfigurationException;
import javax.xml.transform.TransformerConfigurationException;
import javax.xml.transform.TransformerException;
import javax.xml.transform.TransformerFactoryConfigurationError;
import org.w3c.dom.Node;
import java.io.FileOutputStream;
import javax.xml.transform.TransformerFactory;
import javax.xml.transform.Transformer;
import javax.xml.transform.stream.StreamResult;
import javax.xml.transform.dom.DOMSource;
import javax.xml.transform.Source;
import org.w3c.dom.Document;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.parsers.DocumentBuilder;
import java.io.File;
import java.security.KeyStoreException;
import java.security.cert.X509Certificate;
import java.util.List;
import org.apache.xml.security.transforms.Transforms;
import org.apache.xml.security.utils.resolver.ResourceResolver;
import org.xml.sax.SAXException;
import xades4j.XAdES4jException;
import xades4j.properties.AllDataObjsCommitmentTypeProperty;
import xades4j.production.SignedDataObjects;
import xades4j.properties.DataObjectDesc;
import xades4j.production.DataObjectReference;
 
import xades4j.production.XadesBesSigningProfile;
import xades4j.production.XadesSigner;
import xades4j.production.XadesSignatureResult;
import xades4j.production.XadesSigningProfile;
import xades4j.properties.DataObjectTransform;
 
import xades4j.providers.KeyingDataProvider;
import xades4j.providers.SigningCertChainException;
import xades4j.providers.impl.FileSystemKeyStoreKeyingDataProvider;
import xades4j.providers.impl.KeyStoreKeyingDataProvider.SigningCertSelector;
import xades4j.verification.UnexpectedJCAException;
 
public class DevelopedSignature {
 
    private static XadesSigner signer;
     
    public DevelopedSignature() {
        ResourceResolver.register("com.uk.nmi.sw.datavaulttesting.vaulttestingutils.xades.XPointerResourceResolver");
    }
 
     
    //args[0] = certificado ruta
    //args[1] = contraseña ceritificado String
    //args[2] = archivo xml entrada ruta
    //args[3] = archivo xml salida ruta
     
    public static void main(String[] args) throws Exception, IOException {
      
                if(!existFile(args[0])){
                System.out.println("No se encuentra el archivo certificado, verifique la ruta del archivo");
                 
                    System.exit(1);} 
                 
                if(!existFile(args[2])){
                System.out.println("No se encuentra el archivo xml de entrada, verifique la ruta del archivo");
                System.exit(2);} 
                     
        try{
        signer = getSigner(args[1], args[0]);
        }catch(Exception e){
            System.out.println("problema con el certificado, verifique la contraseña o que sea valido: " + e.getMessage());
            System.exit(3);
        }
         
        try{
            signWithoutIDEnveloped(args[3], signer, args[2]);
         }catch(Exception e){
            System.out.println("Problema al leer el xml de entrada: " + e.getMessage());
            System.exit(4);
        }
         
       System.out.println("Sin novedad");
       //System.out.println(args[0]+", "+ args[1]+", "+ args[2]+", "+ args[3]);
    }
 
    public static XadesSigner getSigner(String password, String pfxPath) throws Exception {//SigningException {
        try {
            KeyingDataProvider keyingProvider = getKeyingDataProvider(pfxPath, password);
            XadesSigningProfile p = new XadesBesSigningProfile(keyingProvider);
            return p.newSigner();
        } catch (Exception ex) {
            System.out.println("Error con librerías de firma: "  +  ex.getMessage());
            throw new Exception("Error " + ex);           
        }
 
    }
 
    private static KeyingDataProvider getKeyingDataProvider(String pfxPath, String password) throws KeyStoreException, SigningCertChainException, UnexpectedJCAException {
        KeyingDataProvider keyingProvider = new FileSystemKeyStoreKeyingDataProvider("pkcs12", pfxPath, new SigningCertSelector() {
 
            @Override
            public X509Certificate selectCertificate(List<X509Certificate> list) {
                return list.get(0);
            }
        }, new DirectPasswordProvider(password), new DirectPasswordProvider(password), true);
        if (keyingProvider.getSigningCertificateChain().isEmpty()) {
            throw new IllegalArgumentException("Cannot initialize keystore with path " + pfxPath);
        }
        return keyingProvider;
    }
 
    /**
     * Generate the signature and output a single signed file using the enveloped structure
     * This means that the signature is within the signed XML
     * This method signs the root node, not an ID
     * @param outputPath
     * @param signer
     * @param valid
     * @throws TransformerFactoryConfigurationError
     * @throws XAdES4jException
     * @throws TransformerConfigurationException
     * @throws TransformerException
     * @throws IOException
     * @throws FileNotFoundException
     */
    private static void signWithoutIDEnveloped(String outputPath, XadesSigner signer, String inputPath) throws TransformerFactoryConfigurationError, XAdES4jException, TransformerConfigurationException, TransformerException, IOException, FileNotFoundException {
 
        Document sourceDoc = getDocument(inputPath);
        sourceDoc.setDocumentURI(null);
 
        writeXMLToFile(sourceDoc, outputPath);
 
        sourceDoc = getDocument(outputPath);
 
        Element signatureParent = (Element) sourceDoc.getDocumentElement();
        Element elementToSign = sourceDoc.getDocumentElement();
        String refUri;
        if (elementToSign.hasAttribute("Id")) {
            refUri = '#' + elementToSign.getAttribute("Id");
        } else {
            if (elementToSign.getParentNode().getNodeType() != Node.DOCUMENT_NODE) {
                throw new IllegalArgumentException("Element without Id must be the document root");
            }
            refUri = "";
        }
 
        DataObjectDesc dataObjRef = new DataObjectReference(refUri).withTransform(new DataObjectTransform(Transforms.TRANSFORM_ENVELOPED_SIGNATURE));
        XadesSignatureResult result = signer.sign(new SignedDataObjects(dataObjRef).withCommitmentType(AllDataObjsCommitmentTypeProperty.proofOfOrigin()), signatureParent);
 
 
        writeXMLToFile(sourceDoc, outputPath);
    }
 
    /**
     * Write an XML document to file
     * @param doc The document
     * @param outputPath The path to write the XML file to
     * @throws IOException
     * @throws TransformerConfigurationException
     * @throws TransformerFactoryConfigurationError
     * @throws TransformerException
     * @throws FileNotFoundException
     */
    private static void writeXMLToFile(Document doc, String outputPath) throws IOException, TransformerConfigurationException, TransformerFactoryConfigurationError, TransformerException, FileNotFoundException {
        // Write the output to a file
        Source source = new DOMSource(doc);
 
        // Prepare the output file
        File outFile = new File(outputPath);
        outFile.getParentFile().mkdirs();
        outFile.createNewFile();
        FileOutputStream fos = new FileOutputStream(outFile);
 
        StreamResult result = new StreamResult(fos);
 
        // Write the DOM document to the file
        Transformer xformer = TransformerFactory.newInstance().newTransformer();
        xformer.transform(source, result);
 
        fos.close();
    }
 
    /**
     * Load a Document from an XML file
     * @param path The path to the file
     * @return The document extracted from the file
     */
    private static Document getDocument(String path) {
        try {
            // Load the XML to append the signature to.
            File fXmlFile = new File(path);
            DocumentBuilderFactory dbFactory = DocumentBuilderFactory.newInstance();
            DocumentBuilder dBuilder = dbFactory.newDocumentBuilder();
            Document doc = dBuilder.parse(fXmlFile);
            doc.getDocumentElement().normalize();
            return doc;
        } catch (SAXException ex) {
            return null;
        } catch (IOException ex) {
            return null;
        } catch (ParserConfigurationException ex) {
            return null;
        }
    }
     
   public static boolean existFile(String rutaArchivo){
       String sFichero = rutaArchivo;
        File fichero = new File(sFichero);
         
        if (fichero.exists()){
            return true;
        }else{
            return false;
        }
   }
}
